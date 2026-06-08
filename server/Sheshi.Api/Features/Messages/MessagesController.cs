using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Sheshi.Api.Auth;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;
using Sheshi.Api.Realtime;
using Sheshi.Api.Storage;

namespace Sheshi.Api.Features.Messages;

[ApiController]
[Route("api")]
public class MessagesController(
    AppDbContext db,
    UserManager<ApplicationUser> userManager,
    MessageService messageService,
    IImageStorage imageStorage,
    RealtimeNotifier realtime) : ControllerBase
{
    private static readonly JsonSerializerOptions RequestJsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower
    };

    [HttpGet("rooms/{roomId:guid}/messages")]
    public async Task<ActionResult<IReadOnlyList<MessageDto>>> ListRoomMessages(Guid roomId, CancellationToken ct)
    {
        var messages = await db.Messages
            .AsNoTracking()
            .Where(m => m.RoomId == roomId && m.ParentId == null)
            .OrderByDescending(m => m.CreatedAt)
            .Take(80)
            .ToListAsync(ct);
        messages.Reverse();

        return Ok(await messageService.EnrichAsync(messages, User.GetUserId(), ct));
    }

    [HttpGet("messages/{id:guid}")]
    public async Task<ActionResult<MessageDto>> GetMessage(Guid id, CancellationToken ct)
    {
        var message = await db.Messages.AsNoTracking().SingleOrDefaultAsync(m => m.Id == id, ct);
        if (message is null) return NotFound();

        var dto = await messageService.EnrichAsync([message], User.GetUserId(), ct);
        return Ok(dto.Single());
    }

    [HttpGet("messages/{id:guid}/replies")]
    public async Task<ActionResult<IReadOnlyList<MessageDto>>> ListReplies(Guid id, CancellationToken ct)
    {
        var replies = await db.Messages
            .AsNoTracking()
            .Where(m => m.ParentId == id)
            .OrderBy(m => m.CreatedAt)
            .Take(200)
            .ToListAsync(ct);

        return Ok(await messageService.EnrichAsync(replies, User.GetUserId(), ct));
    }

    [Authorize]
    [HttpPost("messages")]
    public async Task<ActionResult<MessageDto>> PostMessage(CancellationToken ct)
    {
        var parsed = await ReadPostMessageAsync(ct);
        if (parsed.Error is not null) return parsed.Error;
        var request = parsed.Request!;

        var user = await GetCurrentUserAsync();
        if (user is null) return Unauthorized();
        if (user.IsBanned) return Forbid();

        var body = request.Body?.Trim() ?? "";
        if (body.Length == 0) return BadRequest(new { error = "EMPTY" });
        if (body.Length > 2000) return BadRequest(new { error = "TOO_LONG" });

        if (!await db.Rooms.AnyAsync(r => r.Id == request.RoomId, ct)) return NotFound(new { error = "ROOM_NOT_FOUND" });

        if (request.ParentId is not null)
        {
            var parent = await db.Messages.AsNoTracking().SingleOrDefaultAsync(m => m.Id == request.ParentId, ct);
            if (parent is null) return NotFound(new { error = "PARENT_NOT_FOUND" });
            if (parent.ParentId is not null) return BadRequest(new { error = "REPLIES_CANNOT_HAVE_REPLIES" });
            if (parent.RoomId != request.RoomId) return BadRequest(new { error = "PARENT_ROOM_MISMATCH" });
        }

        string? imageUrl = null;
        if (parsed.Image is not null && parsed.Image.Length > 0)
        {
            try
            {
                await using var stream = parsed.Image.OpenReadStream();
                imageUrl = await imageStorage.SaveAsync(stream, parsed.Image.ContentType, ct);
            }
            catch (ImageStorageException ex)
            {
                return BadRequest(new { error = ex.Code });
            }
        }

        var message = new Message
        {
            RoomId = request.RoomId,
            AuthorId = user.Id,
            ParentId = request.ParentId,
            Body = body,
            ImageUrl = imageUrl
        };
        db.Messages.Add(message);
        await db.SaveChangesAsync(ct);
        await realtime.MessageChangedAsync(message.RoomId, message.ParentId, ct);

        var dto = await messageService.EnrichAsync([message], user.Id, ct);
        return CreatedAtAction(nameof(GetMessage), new { id = message.Id }, dto.Single());
    }

    [Authorize]
    [HttpPut("messages/{id:guid}/vote")]
    public async Task<IActionResult> Upvote(Guid id, CancellationToken ct)
    {
        var user = await GetCurrentUserAsync();
        if (user is null) return Unauthorized();
        if (user.IsBanned) return Forbid();

        var message = await db.Messages.AsNoTracking().SingleOrDefaultAsync(m => m.Id == id, ct);
        if (message is null) return NotFound();
        if (message.ParentId is not null) return BadRequest(new { error = "CANNOT_VOTE_ON_REPLY" });

        var exists = await db.Votes.AnyAsync(v => v.MessageId == id && v.UserId == user.Id, ct);
        if (!exists)
        {
            db.Votes.Add(new Vote { MessageId = id, UserId = user.Id });
            await db.SaveChangesAsync(ct);
        }

        await realtime.MessageChangedAsync(message.RoomId, id, ct);
        return NoContent();
    }

    [Authorize]
    [HttpDelete("messages/{id:guid}/vote")]
    public async Task<IActionResult> RemoveUpvote(Guid id, CancellationToken ct)
    {
        var user = await GetCurrentUserAsync();
        if (user is null) return Unauthorized();

        var vote = await db.Votes.Include(v => v.Message).SingleOrDefaultAsync(v => v.MessageId == id && v.UserId == user.Id, ct);
        if (vote is not null)
        {
            var roomId = vote.Message.RoomId;
            db.Votes.Remove(vote);
            await db.SaveChangesAsync(ct);
            await realtime.MessageChangedAsync(roomId, id, ct);
        }

        return NoContent();
    }

    [Authorize]
    [HttpDelete("messages/{id:guid}")]
    public async Task<IActionResult> SoftDelete(Guid id, CancellationToken ct)
    {
        var user = await GetCurrentUserAsync();
        if (user is null) return Unauthorized();

        var message = await db.Messages.SingleOrDefaultAsync(m => m.Id == id, ct);
        if (message is null) return NotFound();

        var canModerate = await userManager.IsInRoleAsync(user, Roles.Moderator) ||
                          await userManager.IsInRoleAsync(user, Roles.Admin);
        if (message.AuthorId != user.Id && !canModerate) return Forbid();

        message.DeletedAt ??= DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        await realtime.MessageChangedAsync(message.RoomId, message.ParentId ?? message.Id, ct);
        return NoContent();
    }

    [Authorize]
    [HttpPost("messages/{id:guid}/report")]
    public async Task<IActionResult> Report(Guid id, ReportMessageRequest request, CancellationToken ct)
    {
        var user = await GetCurrentUserAsync();
        if (user is null) return Unauthorized();
        if (!await db.Messages.AnyAsync(m => m.Id == id, ct)) return NotFound();
        if ((request.Note?.Length ?? 0) > 500) return BadRequest(new { error = "NOTE_TOO_LONG" });

        db.Reports.Add(new Report
        {
            MessageId = id,
            ReporterId = user.Id,
            Reason = request.Reason,
            Note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim()
        });
        await db.SaveChangesAsync(ct);

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
