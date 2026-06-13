using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Sheshi.Api.Auth;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;
using Sheshi.Api.Features.Moderation;
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
    RealtimeNotifier realtime,
    ModerationActionLogger actionLogger,
    ModerationRuleEngine moderationRuleEngine) : ControllerBase
{
    private static readonly JsonSerializerOptions RequestJsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower
    };

    [HttpGet("rooms/{roomId:guid}/messages")]
    public async Task<ActionResult<CursorPageDto<MessageDto>>> ListRoomMessages(
        Guid roomId,
        [FromQuery] int limit = 40,
        [FromQuery] string? cursor = null,
        CancellationToken ct = default)
    {
        return Ok(await messageService.ListRoomMessagesAsync(roomId, User.GetUserId(), limit, cursor, ct));
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
    public async Task<ActionResult<CursorPageDto<MessageDto>>> ListReplies(
        Guid id,
        [FromQuery] int limit = 80,
        [FromQuery] string? cursor = null,
        CancellationToken ct = default)
    {
        return Ok(await messageService.ListRepliesAsync(id, User.GetUserId(), limit, cursor, ct));
    }

    [HttpGet("threads/{id:guid}")]
    public async Task<ActionResult<ThreadDto>> GetThread(Guid id, CancellationToken ct)
    {
        var requested = await db.Messages.AsNoTracking().SingleOrDefaultAsync(m => m.Id == id, ct);
        if (requested is null) return NotFound();

        var root = await ResolveRootAsync(requested, ct);
        var roomReplies = await LoadThreadDescendantsAsync(root, ct);

        var repliesByParent = roomReplies
            .GroupBy(m => m.ParentId!.Value)
            .ToDictionary(g => g.Key, g => g.OrderBy(m => m.CreatedAt).ToList());

        var threadMessages = new List<Message> { root };
        CollectDescendants(root.Id, repliesByParent, threadMessages);

        var enriched = await messageService.EnrichAsync(threadMessages, User.GetUserId(), ct);
        var enrichedById = enriched.ToDictionary(m => m.Id);
        var nodes = BuildReplyNodes(root.Id, repliesByParent, enrichedById, 1);

        return Ok(new ThreadDto(enrichedById[root.Id], nodes));
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

        var body = request.Body?.Trim() ?? "";
        var hasImage = parsed.Image is not null && parsed.Image.Length > 0;
        if (body.Length == 0 && !hasImage) return BadRequest(new { error = "EMPTY" });
        if (body.Length > 2000) return BadRequest(new { error = "TOO_LONG" });

        if (!await db.Rooms.AnyAsync(r => r.Id == request.RoomId, ct)) return NotFound(new { error = "ROOM_NOT_FOUND" });

        if (request.ParentId is not null)
        {
            var parent = await db.Messages.AsNoTracking().SingleOrDefaultAsync(m => m.Id == request.ParentId, ct);
            if (parent is null) return NotFound(new { error = "PARENT_NOT_FOUND" });
            if (parent.RoomId != request.RoomId) return BadRequest(new { error = "PARENT_ROOM_MISMATCH" });
        }

        string? imageUrl = null;
        if (hasImage)
        {
            try
            {
                await using var stream = parsed.Image!.OpenReadStream();
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
        await moderationRuleEngine.EvaluateAsync(message, ct);

        var rootId = await GetThreadRootIdAsync(message, ct);
        var broadcast = (await messageService.EnrichAsync([message], null, ct)).Single();
        await realtime.MessageCreatedAsync(broadcast, message.ParentId is null ? null : rootId, ct);

        var dto = await messageService.EnrichAsync([message], user.Id, ct);
        return CreatedAtAction(nameof(GetMessage), new { id = message.Id }, dto.Single());
    }

    [Authorize]
    [EnableRateLimiting("writes")]
    [HttpPut("messages/{id:guid}/vote")]
    public async Task<IActionResult> Upvote(Guid id, CancellationToken ct)
    {
        var user = await GetCurrentUserAsync();
        if (user is null) return Unauthorized();
        if (user.IsBanned) return Forbid();

        var message = await db.Messages.AsNoTracking().SingleOrDefaultAsync(m => m.Id == id, ct);
        if (message is null) return NotFound();

        var exists = await db.Votes.AnyAsync(v => v.MessageId == id && v.UserId == user.Id, ct);
        if (!exists)
        {
            db.Votes.Add(new Vote { MessageId = id, UserId = user.Id });
            await db.SaveChangesAsync(ct);
        }

        var upvotes = await db.Votes.CountAsync(v => v.MessageId == id, ct);
        await realtime.VoteChangedAsync(id, message.RoomId, upvotes,
            message.ParentId is null ? null : await GetThreadRootIdAsync(message, ct), ct);
        return NoContent();
    }

    [Authorize]
    [EnableRateLimiting("writes")]
    [HttpDelete("messages/{id:guid}/vote")]
    public async Task<IActionResult> RemoveUpvote(Guid id, CancellationToken ct)
    {
        var user = await GetCurrentUserAsync();
        if (user is null) return Unauthorized();

        var vote = await db.Votes.Include(v => v.Message).SingleOrDefaultAsync(v => v.MessageId == id && v.UserId == user.Id, ct);
        if (vote is not null)
        {
            var roomId = vote.Message.RoomId;
            var threadId = await GetThreadRootIdAsync(vote.Message, ct);
            var isReply = vote.Message.ParentId is not null;
            db.Votes.Remove(vote);
            await db.SaveChangesAsync(ct);
            var upvotes = await db.Votes.CountAsync(v => v.MessageId == id, ct);
            await realtime.VoteChangedAsync(id, roomId, upvotes, isReply ? threadId : null, ct);
        }

        return NoContent();
    }

    [Authorize]
    [EnableRateLimiting("writes")]
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
        if (canModerate && message.AuthorId != user.Id)
            await actionLogger.LogAsync(User, ModerationActionTypes.MessageDeleted, "message", message.Id, ct: ct);
        await realtime.MessageDeletedAsync(message.Id, message.RoomId,
            message.ParentId is null ? null : await GetThreadRootIdAsync(message, ct), ct);
        return NoContent();
    }

    [Authorize]
    [EnableRateLimiting("reports")]
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

    private async Task<Guid> GetThreadRootIdAsync(Message message, CancellationToken ct)
    {
        var root = await ResolveRootAsync(message, ct);
        return root.Id;
    }

    private async Task<Message> ResolveRootAsync(Message message, CancellationToken ct)
    {
        var current = message;
        var seen = new HashSet<Guid> { current.Id };

        while (current.ParentId is Guid parentId && seen.Add(parentId))
        {
            var parent = await db.Messages.AsNoTracking().SingleOrDefaultAsync(m => m.Id == parentId, ct);
            if (parent is null) break;
            current = parent;
        }

        return current;
    }

    private async Task<IReadOnlyList<Message>> LoadThreadDescendantsAsync(Message root, CancellationToken ct)
    {
        const int maxMessages = 1000;
        const int maxDepth = 100;

        var descendants = new List<Message>();
        var frontier = new List<Guid> { root.Id };

        for (var depth = 0; depth < maxDepth && frontier.Count > 0 && descendants.Count < maxMessages; depth++)
        {
            var children = await db.Messages
                .AsNoTracking()
                .Where(m => m.RoomId == root.RoomId && m.ParentId != null && frontier.Contains(m.ParentId.Value))
                .OrderBy(m => m.CreatedAt)
                .ToListAsync(ct);

            if (children.Count == 0) break;

            var remaining = maxMessages - descendants.Count;
            var accepted = children.Take(remaining).ToList();
            descendants.AddRange(accepted);
            frontier = accepted.Select(m => m.Id).ToList();
        }

        return descendants;
    }

    private static void CollectDescendants(
        Guid parentId,
        IReadOnlyDictionary<Guid, List<Message>> repliesByParent,
        ICollection<Message> result)
    {
        if (!repliesByParent.TryGetValue(parentId, out var children)) return;

        foreach (var child in children)
        {
            result.Add(child);
            CollectDescendants(child.Id, repliesByParent, result);
        }
    }

    private static IReadOnlyList<ReplyNodeDto> BuildReplyNodes(
        Guid parentId,
        IReadOnlyDictionary<Guid, List<Message>> repliesByParent,
        IReadOnlyDictionary<Guid, MessageDto> enrichedById,
        int depth)
    {
        if (!repliesByParent.TryGetValue(parentId, out var children)) return [];

        return children
            .Where(child => enrichedById.ContainsKey(child.Id))
            .Select(child => new ReplyNodeDto(
                enrichedById[child.Id],
                BuildReplyNodes(child.Id, repliesByParent, enrichedById, depth + 1),
                depth))
            .ToList();
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
