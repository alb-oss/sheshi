using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Sheshi.Api.Auth;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Features.Messages;

[ApiController]
[Route("api")]
public class MessagesController(
    UserManager<ApplicationUser> userManager,
    MessageService messageService) : ControllerBase
{
    private static readonly JsonSerializerOptions RequestJsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower
    };

    [HttpGet("rooms/{roomId:guid}/messages")]
    [EnableRateLimiting("reads")]
    public async Task<ActionResult<CursorPageDto<MessageDto>>> ListRoomMessages(
        Guid roomId,
        [FromQuery] int limit = 40,
        [FromQuery] string? cursor = null,
        CancellationToken ct = default)
    {
        return Ok(await messageService.ListRoomMessagesAsync(roomId, User.GetUserId(), limit, cursor, ct));
    }

    [HttpGet("messages/{id:guid}")]
    [EnableRateLimiting("reads")]
    public async Task<ActionResult<MessageDto>> GetMessage(Guid id, CancellationToken ct)
    {
        var message = await messageService.GetMessageAsync(id, User.GetUserId(), ct);
        return message is null ? NotFound() : Ok(message);
    }

    [HttpGet("messages/{id:guid}/replies")]
    [EnableRateLimiting("reads")]
    public async Task<ActionResult<CursorPageDto<MessageDto>>> ListReplies(
        Guid id,
        [FromQuery] int limit = 80,
        [FromQuery] string? cursor = null,
        CancellationToken ct = default)
    {
        return Ok(await messageService.ListRepliesAsync(id, User.GetUserId(), limit, cursor, ct));
    }

    [HttpGet("threads/{id:guid}")]
    [EnableRateLimiting("reads")]
    public async Task<ActionResult<ThreadDto>> GetThread(Guid id, CancellationToken ct)
    {
        var thread = await messageService.GetThreadAsync(id, User.GetUserId(), ct);
        return thread is null ? NotFound() : Ok(thread);
    }

    [Authorize]
    [EnableRateLimiting("writes")]
    [HttpPost("messages")]
    public async Task<ActionResult<MessageDto>> PostMessage(CancellationToken ct)
    {
        var parsed = await ReadPostMessageAsync(ct);
        if (parsed.Error is not null) return parsed.Error;
        var request = parsed.Request!;

        var user = await GetCurrentUserAsync();
        if (user is null) return Unauthorized();
        if (user.IsBanned) return Forbid();

        // Root threads are admin-curated; replies stay open to everyone.
        if (request.ParentId is null && !await userManager.IsInRoleAsync(user, Roles.Admin))
            return Forbid();

        var result = await messageService.CreateMessageAsync(user.Id, request, parsed.Image, ct);
        if (result.Error == "ROOM_NOT_FOUND") return NotFound(new { error = result.Error });
        if (result.Error == "PARENT_NOT_FOUND") return NotFound(new { error = result.Error });
        if (result.Error == "PARENT_ROOM_MISMATCH") return BadRequest(new { error = result.Error });
        if (result.Entity is null || result.Dto is null) return BadRequest(new { error = result.Error ?? "MESSAGE_CREATE_FAILED" });

        return CreatedAtAction(nameof(GetMessage), new { id = result.Entity.Id }, result.Dto);
    }

    [Authorize]
    [EnableRateLimiting("writes")]
    [HttpPut("messages/{id:guid}/vote")]
    public async Task<IActionResult> Upvote(Guid id, CancellationToken ct)
    {
        var user = await GetCurrentUserAsync();
        if (user is null) return Unauthorized();
        if (user.IsBanned) return Forbid();

        var found = await messageService.UpvoteAsync(id, user.Id, ct);
        if (!found) return NotFound();
        return NoContent();
    }

    [Authorize]
    [EnableRateLimiting("writes")]
    [HttpDelete("messages/{id:guid}/vote")]
    public async Task<IActionResult> RemoveUpvote(Guid id, CancellationToken ct)
    {
        var user = await GetCurrentUserAsync();
        if (user is null) return Unauthorized();

        await messageService.RemoveUpvoteAsync(id, user.Id, ct);
        return NoContent();
    }

    [Authorize]
    [EnableRateLimiting("writes")]
    [HttpDelete("messages/{id:guid}")]
    public async Task<IActionResult> SoftDelete(Guid id, CancellationToken ct)
    {
        var user = await GetCurrentUserAsync();
        if (user is null) return Unauthorized();

        var canModerate = await userManager.IsInRoleAsync(user, Roles.Moderator) ||
                          await userManager.IsInRoleAsync(user, Roles.Admin);
        var result = await messageService.SoftDeleteAsync(id, user.Id, canModerate, ct);
        if (!result.Found) return NotFound();
        if (!result.Authorized) return Forbid();

        return NoContent();
    }

    [Authorize]
    [EnableRateLimiting("writes")]
    [HttpPost("messages/{id:guid}/report")]
    public async Task<IActionResult> Report(Guid id, ReportMessageRequest request, CancellationToken ct)
    {
        var user = await GetCurrentUserAsync();
        if (user is null) return Unauthorized();
        if (user.IsBanned) return Forbid();

        var result = await messageService.ReportAsync(id, user.Id, request, ct);
        if (!result.Found) return NotFound();
        if (result.Error is not null) return BadRequest(new { error = result.Error });

        return Created($"/api/messages/{id}/report", null);
    }

    private async Task<ApplicationUser?> GetCurrentUserAsync()
    {
        var id = User.GetUserId();
        return id is null ? null : await userManager.FindByIdAsync(id.Value.ToString());
    }

    private async Task<(PostMessageRequest? Request, IFormFile? Image, ActionResult<MessageDto>? Error)> ReadPostMessageAsync(CancellationToken ct)
    {
        if (Request.HasFormContentType)
        {
            var form = await Request.ReadFormAsync(ct);
            if (!Guid.TryParse(form["room_id"], out var roomId))
                return (null, null, BadRequest(new { error = "INVALID_ROOM_ID" }));

            Guid? parentId = null;
            var parentRaw = form["parent_id"].ToString();
            if (!string.IsNullOrWhiteSpace(parentRaw))
            {
                if (!Guid.TryParse(parentRaw, out var parsedParentId))
                    return (null, null, BadRequest(new { error = "INVALID_PARENT_ID" }));
                parentId = parsedParentId;
            }

            var body = form["body"].ToString();
            return (new PostMessageRequest(roomId, parentId, body), form.Files.GetFile("image"), null);
        }

        var request = await Request.ReadFromJsonAsync<PostMessageRequest>(RequestJsonOptions, cancellationToken: ct);
        return request is null
            ? (null, null, BadRequest(new { error = "INVALID_MESSAGE_REQUEST" }))
            : (request, null, null);
    }
}
