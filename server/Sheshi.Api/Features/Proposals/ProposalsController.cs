using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Sheshi.Api.Auth;
using Sheshi.Api.Domain;
using Sheshi.Api.Features.Moderation;
using Sheshi.Api.Realtime;

namespace Sheshi.Api.Features.Proposals;

// Civic proposals API. Reads are anonymous; writes require an authenticated, non-banned user; the queue
// and review/close actions are moderator-gated and audit-logged. Validation lives here (fail closed,
// structured { error } codes); the service stays exception-free. Vote broadcasts go through the coalescer.
[ApiController]
[Route("api/proposals")]
public class ProposalsController(
    ProposalService proposals,
    UserManager<ApplicationUser> userManager,
    RealtimeNotifier realtime,
    ProposalVoteCoalescer voteCoalescer,
    ModerationActionLogger actionLogger) : ControllerBase
{
    private const int MaxTitle = 200;
    private const int MaxBody = 8000;

    [EnableRateLimiting("reads")]
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<ProposalDto>>> List([FromQuery] ProposalListQuery query, CancellationToken ct)
    {
        if (!TryParseStatus(query.Status, out var status)) return BadRequest(new { error = "INVALID_STATUS" });
        // Only the two public lists are served here; the Pending review queue has its own gated endpoint.
        if (status is not (ProposalStatus.Proposed or ProposalStatus.Approved))
            return BadRequest(new { error = "INVALID_STATUS" });
        if (!TryParseCategory(query.Category, out var category)) return BadRequest(new { error = "INVALID_CATEGORY" });

        return Ok(await proposals.ListAsync(status, category, User.GetUserId(), query.Limit, ct));
    }

    [EnableRateLimiting("reads")]
    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ProposalDto>> Get(Guid id, CancellationToken ct)
    {
        var callerId = User.GetUserId();
        var proposal = await proposals.GetAsync(id, callerId, ct);
        if (proposal is null) return NotFound();

        // Pending/Rejected proposals are visible only to their author or a moderator; everyone else gets 404.
        var visible = proposal.Status is ProposalStatus.Proposed or ProposalStatus.Approved
            || proposal.AuthorId == callerId
            || User.IsInRole(Roles.Moderator) || User.IsInRole(Roles.Admin);
        return visible ? Ok(proposal) : NotFound();
    }

    [Authorize]
    [EnableRateLimiting("proposals")]
    [HttpPost]
    public async Task<ActionResult<ProposalDto>> Create([FromBody] CreateProposalRequest request, CancellationToken ct)
    {
        var error = ValidateContent(request.Title, request.Body);
        if (error is not null) return BadRequest(new { error });

        var user = await GetCurrentUserAsync();
        if (user is null) return Unauthorized();
        if (user.IsBanned) return Forbid();

        // Submitted as Pending (hidden) — no broadcast until a moderator publishes it.
        var dto = await proposals.CreateAsync(user.Id, request, ct);
        return CreatedAtAction(nameof(Get), new { id = dto.Id }, dto);
    }

    [Authorize]
    [EnableRateLimiting("writes")]
    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Edit(Guid id, [FromBody] EditProposalRequest request, CancellationToken ct)
    {
        var error = ValidateContent(request.Title, request.Body);
        if (error is not null) return BadRequest(new { error });

        var user = await GetCurrentUserAsync();
        if (user is null) return Unauthorized();
        if (user.IsBanned) return Forbid();

        return MapMutationError(await proposals.EditAsync(id, user.Id, request, ct));
    }

    [Authorize]
    [EnableRateLimiting("writes")]
    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Withdraw(Guid id, CancellationToken ct)
    {
        var user = await GetCurrentUserAsync();
        if (user is null) return Unauthorized();
        if (user.IsBanned) return Forbid();

        var result = await proposals.WithdrawAsync(id, user.Id, ct);
        if (result is null) await realtime.ProposalRemovedAsync(id, ct);
        return MapMutationError(result);
    }

    [Authorize]
    [EnableRateLimiting("writes")]
    [HttpPut("{id:guid}/vote")]
    public async Task<IActionResult> Vote(Guid id, [FromBody] VoteProposalRequest request, CancellationToken ct)
    {
        if (request.Value is not (-1 or 0 or 1)) return BadRequest(new { error = "INVALID_VOTE" });

        var user = await GetCurrentUserAsync();
        if (user is null) return Unauthorized();
        if (user.IsBanned) return Forbid();

        var result = await proposals.VoteAsync(id, user.Id, request.Value, ct);
        if (result.Error == "NOT_FOUND") return NotFound();
        if (result.Error == "NOT_OPEN") return Conflict(new { error = result.Error });
        if (result.Error is not null) return BadRequest(new { error = result.Error });

        // Aggregate tally (coalesced) to everyone; the caller's own vote privately to their devices.
        voteCoalescer.Request(id, result.Score, result.Pro, result.Kunder);
        await realtime.MyProposalVoteChangedAsync(user.Id, id, request.Value, ct);
        if (result.Approved)
        {
            var dto = await proposals.GetAsync(id, null, ct);
            if (dto is not null) await realtime.ProposalApprovedAsync(dto, ct);
        }
        return NoContent();
    }

    // --- Moderation (gated + audit-logged) ---

    [Authorize(Roles = Roles.ModeratorOrAdmin)]
    [EnableRateLimiting("reads")]
    [HttpGet("queue")]
    public async Task<ActionResult<IReadOnlyList<ProposalDto>>> Queue([FromQuery] ProposalListQuery query, CancellationToken ct)
    {
        if (!TryParseCategory(query.Category, out var category)) return BadRequest(new { error = "INVALID_CATEGORY" });
        return Ok(await proposals.ListQueueAsync(category, query.Limit, ct));
    }

    [Authorize(Roles = Roles.ModeratorOrAdmin)]
    [EnableRateLimiting("moderation")]
    [HttpPut("{id:guid}/review")]
    public async Task<IActionResult> Review(Guid id, [FromBody] ReviewProposalRequest request, CancellationToken ct)
    {
        if (request.Action is not ("publish" or "reject")) return BadRequest(new { error = "INVALID_ACTION" });

        var result = await proposals.ReviewAsync(id, request.Action, ct);
        if (result.Error == "NOT_FOUND") return NotFound();
        if (result.Error == "NOT_PENDING") return Conflict(new { error = result.Error });
        if (result.Error is not null) return BadRequest(new { error = result.Error });

        var actionType = request.Action == "publish"
            ? ModerationActionTypes.ProposalPublished
            : ModerationActionTypes.ProposalRejected;
        await actionLogger.LogAsync(User, actionType, "proposal", id, ct: ct);
        // Publishing makes it public → broadcast so it slots into Propozuara live.
        if (request.Action == "publish") await realtime.ProposalCreatedAsync(result.Dto!, ct);
        return NoContent();
    }

    [Authorize(Roles = Roles.ModeratorOrAdmin)]
    [EnableRateLimiting("moderation")]
    [HttpPut("{id:guid}/close")]
    public async Task<IActionResult> Close(Guid id, CancellationToken ct)
    {
        var result = await proposals.CloseAsync(id, ct);
        if (result == "NOT_FOUND") return NotFound();
        if (result is not null) return BadRequest(new { error = result });

        await actionLogger.LogAsync(User, ModerationActionTypes.ProposalClosed, "proposal", id, ct: ct);
        await realtime.ProposalRemovedAsync(id, ct);
        return NoContent();
    }

    // --- helpers ---

    private static string? ValidateContent(string? title, string? body)
    {
        title = title?.Trim();
        body = body?.Trim();
        if (string.IsNullOrWhiteSpace(title)) return "TITLE_REQUIRED";
        if (title.Length > MaxTitle) return "TITLE_TOO_LONG";
        if (string.IsNullOrWhiteSpace(body)) return "BODY_REQUIRED";
        if (body.Length > MaxBody) return "BODY_TOO_LONG";
        return null;
    }

    private IActionResult MapMutationError(string? error) => error switch
    {
        null => NoContent(),
        "NOT_FOUND" => NotFound(),
        "FORBIDDEN" => Forbid(),
        "HAS_VOTES" or "NOT_EDITABLE" or "NOT_WITHDRAWABLE" => Conflict(new { error }),
        _ => BadRequest(new { error }),
    };

    private static bool TryParseStatus(string? raw, out ProposalStatus status)
    {
        status = default;
        return !string.IsNullOrWhiteSpace(raw)
            && Enum.TryParse(raw, ignoreCase: true, out status)
            && Enum.IsDefined(status);
    }

    private static bool TryParseCategory(string? raw, out ProposalCategory? category)
    {
        category = null;
        if (string.IsNullOrWhiteSpace(raw)) return true; // category is an optional filter
        if (Enum.TryParse<ProposalCategory>(raw, ignoreCase: true, out var parsed) && Enum.IsDefined(parsed))
        {
            category = parsed;
            return true;
        }
        return false;
    }

    private async Task<ApplicationUser?> GetCurrentUserAsync()
    {
        var id = User.GetUserId();
        return id is null ? null : await userManager.FindByIdAsync(id.Value.ToString());
    }
}
