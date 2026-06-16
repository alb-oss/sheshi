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
    IVideoStorage videoStorage,
    RealtimeNotifier realtime,
    ModerationActionLogger actionLogger,
    ModerationRuleEngine moderationRuleEngine,
    ILogger<MessagesController> logger) : ControllerBase
{
    private static readonly JsonSerializerOptions RequestJsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower
    };

    [EnableRateLimiting("reads")]
    [HttpGet("rooms/{roomId:guid}/messages")]
    public async Task<ActionResult<CursorPageDto<MessageDto>>> ListRoomMessages(
        Guid roomId,
        [FromQuery] int limit = 40,
        [FromQuery] string? cursor = null,
        CancellationToken ct = default)
    {
        return Ok(await messageService.ListRoomMessagesAsync(roomId, User.GetUserId(), limit, cursor, ct));
    }

    // Flat, chronological list of every image/video in the room — feeds the swipeable media gallery.
    [EnableRateLimiting("reads")]
    [HttpGet("rooms/{roomId:guid}/media")]
    public async Task<ActionResult<IReadOnlyList<MediaDto>>> ListRoomMedia(Guid roomId, CancellationToken ct) =>
        Ok(await messageService.ListRoomMediaAsync(roomId, ct));

    [EnableRateLimiting("reads")]
    [HttpGet("messages/{id:guid}")]
    public async Task<ActionResult<MessageDto>> GetMessage(Guid id, CancellationToken ct)
    {
        var message = await db.Messages.AsNoTracking().SingleOrDefaultAsync(m => m.Id == id, ct);
        if (message is null) return NotFound();

        var dto = await messageService.EnrichAsync([message], User.GetUserId(), ct);
        return Ok(dto.Single());
    }

    [EnableRateLimiting("reads")]
    [HttpGet("messages/{id:guid}/replies")]
    public async Task<ActionResult<CursorPageDto<MessageDto>>> ListReplies(
        Guid id,
        [FromQuery] int limit = 80,
        [FromQuery] string? cursor = null,
        CancellationToken ct = default)
    {
        return Ok(await messageService.ListRepliesAsync(id, User.GetUserId(), limit, cursor, ct));
    }

    [EnableRateLimiting("reads")]
    [HttpGet("threads/{id:guid}")]
    public async Task<ActionResult<ThreadDto>> GetThread(Guid id, CancellationToken ct)
    {
        var requested = await db.Messages.AsNoTracking().SingleOrDefaultAsync(m => m.Id == id, ct);
        if (requested is null) return NotFound();

        // The detail page is rooted at the REQUESTED message itself (post OR reply), showing it
        // and its descendants — so a reply's permalink opens that reply's own subtree, not the
        // whole thread from the top. (Reddit-style comment permalinks.)
        var root = requested;
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
    [RequestSizeLimit(55 * 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = 55 * 1024 * 1024)]
    public async Task<ActionResult<MessageDto>> PostMessage(CancellationToken ct)
    {
        var parsed = await ReadPostMessageAsync(ct);
        if (parsed.Error is not null) return parsed.Error;
        var request = parsed.Request!;

        var user = await GetCurrentUserAsync();
        if (user is null) return Unauthorized();
        if (user.IsBanned) return Forbid();

        // Open posting (deliberate, Reddit-style): root threads AND replies are open to any
        // signed-in, non-banned user — no admin gate. Product decision, see the rewrite master-spec.
        var body = request.Body?.Trim() ?? "";
        var hasImage = parsed.Image is not null && parsed.Image.Length > 0;
        var hasVideo = parsed.Video is not null && parsed.Video.Length > 0;
        if (body.Length == 0 && !hasImage && !hasVideo) return BadRequest(new { error = "EMPTY" });
        if (body.Length > 2000) return BadRequest(new { error = "TOO_LONG" });

        if (!await db.Rooms.AnyAsync(r => r.Id == request.RoomId, ct)) return NotFound(new { error = "ROOM_NOT_FOUND" });

        if (request.ParentId is not null)
        {
            var parent = await db.Messages.AsNoTracking().SingleOrDefaultAsync(m => m.Id == request.ParentId, ct);
            if (parent is null) return NotFound(new { error = "PARENT_NOT_FOUND" });
            if (parent.RoomId != request.RoomId) return BadRequest(new { error = "PARENT_ROOM_MISMATCH" });
        }

        string? imageUrl = null;
        string? videoUrl = null;
        try
        {
            if (hasImage)
            {
                await using var stream = parsed.Image!.OpenReadStream();
                imageUrl = await imageStorage.SaveAsync(stream, parsed.Image.ContentType, ct);
            }
            if (hasVideo)
            {
                await using var stream = parsed.Video!.OpenReadStream();
                videoUrl = await videoStorage.SaveAsync(stream, parsed.Video.ContentType, ct);
            }
        }
        catch (ImageStorageException ex)
        {
            return BadRequest(new { error = ex.Code });
        }
        catch (Exception ex)
        {
            // A storage-backend failure (e.g. the object store rejecting the request) — log the real
            // cause and return a clear, mapped error instead of a silent generic 500.
            logger.LogError(
                ex,
                "Upload to object storage failed (image={HasImage}, video={HasVideo}, videoType={VideoType})",
                hasImage, hasVideo, parsed.Video?.ContentType);
            return StatusCode(StatusCodes.Status502BadGateway, new { error = "UPLOAD_FAILED" });
        }

        var message = new Message
        {
            RoomId = request.RoomId,
            AuthorId = user.Id,
            ParentId = request.ParentId,
            Body = body,
            ImageUrl = imageUrl,
            VideoUrl = videoUrl
        };
        db.Messages.Add(message);
        await db.SaveChangesAsync(ct);
        var autoFlags = await moderationRuleEngine.EvaluateAsync(message, ct);
        if (autoFlags.Count > 0) await realtime.ModerationChangedAsync(ct); // live flag queue

        var rootId = await GetThreadRootIdAsync(message, ct);
        var broadcast = (await messageService.EnrichAsync([message], null, ct)).Single();
        await realtime.MessageCreatedAsync(broadcast, message.ParentId is null ? null : rootId, ct);

        var dto = await messageService.EnrichAsync([message], user.Id, ct);
        return CreatedAtAction(nameof(GetMessage), new { id = message.Id }, dto.Single());
    }

    // Reddit-style directional vote. Body { "value": 1 | -1 | 0 }: upserts the caller's vote
    // to that direction; 0 clears it. Net message score = SUM(Value), broadcast over realtime.
    [Authorize]
    [EnableRateLimiting("writes")]
    [HttpPut("messages/{id:guid}/vote")]
    public async Task<IActionResult> Vote(Guid id, [FromBody] VoteRequest request, CancellationToken ct)
    {
        if (request.Value is not (-1 or 0 or 1)) return BadRequest(new { error = "INVALID_VOTE" });

        var user = await GetCurrentUserAsync();
        if (user is null) return Unauthorized();
        if (user.IsBanned) return Forbid();

        var message = await db.Messages.AsNoTracking().SingleOrDefaultAsync(m => m.Id == id, ct);
        if (message is null) return NotFound();

        // Atomic upsert/delete instead of read-then-write: a concurrent double-tap used to have both
        // requests observe "no existing vote", both INSERT, and the second hit the composite PK
        // (MessageId, UserId) — an unhandled 23505 surfaced as HTTP 500. ON CONFLICT collapses the race
        // to a single round-trip (the second writer lands on DO UPDATE), and DELETE is idempotent.
        // Value=0 is gated to DELETE above the INSERT so CK_Votes_Value (Value IN (-1,1)) is never hit.
        if (request.Value == 0)
        {
            await db.Database.ExecuteSqlAsync(
                $@"DELETE FROM ""Votes"" WHERE ""MessageId"" = {id} AND ""UserId"" = {user.Id}", ct);
        }
        else
        {
            var value = (short)request.Value;
            var now = DateTimeOffset.UtcNow;
            await db.Database.ExecuteSqlAsync(
                $@"INSERT INTO ""Votes"" (""MessageId"", ""UserId"", ""Value"", ""CreatedAt"")
                   VALUES ({id}, {user.Id}, {value}, {now})
                   ON CONFLICT (""MessageId"", ""UserId"")
                   DO UPDATE SET ""Value"" = EXCLUDED.""Value""", ct);
        }

        var score = await db.Votes.Where(v => v.MessageId == id).SumAsync(v => (int)v.Value, ct);
        // The thread detail page joins the THREAD group keyed by the thread root id. For a root post
        // that root IS the message itself, so resolve the root unconditionally (not just for replies)
        // — otherwise a vote on a root post broadcasts only to the room group and the open thread view
        // never sees the live score change.
        var threadRootId = message.ParentId is null ? message.Id : await GetThreadRootIdAsync(message, ct);
        await realtime.VoteChangedAsync(id, message.RoomId, score, threadRootId, ct);
        // Sync the caller's OWN vote to their other devices/tabs (color follows my_vote). Sent only to
        // this user's connections — the public echo above never reveals who voted.
        await realtime.MyVoteChangedAsync(user.Id, id, request.Value, ct);
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
        var message = await db.Messages.AsNoTracking().FirstOrDefaultAsync(m => m.Id == id, ct);
        if (message is null) return NotFound();
        if ((request.Note?.Length ?? 0) > 500) return BadRequest(new { error = "NOTE_TOO_LONG" });
        // Reporting your own message is nonsensical; the UI hides the action but enforce it here too.
        if (message.AuthorId == user.Id) return BadRequest(new { error = "CANNOT_REPORT_OWN" });
        // Report once: a second report from the same user is rejected (and a unique index backstops
        // a race). The client treats 409 as "already reported" rather than an error.
        if (await db.Reports.AnyAsync(r => r.MessageId == id && r.ReporterId == user.Id, ct))
            return Conflict(new { error = "ALREADY_REPORTED" });

        db.Reports.Add(new Report
        {
            MessageId = id,
            ReporterId = user.Id,
            Reason = request.Reason,
            Note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim()
        });
        await db.SaveChangesAsync(ct);
        await realtime.ModerationChangedAsync(ct); // live moderation queue

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

    private async Task<(PostMessageRequest? Request, IFormFile? Image, IFormFile? Video, ActionResult<MessageDto>? Error)> ReadPostMessageAsync(CancellationToken ct)
    {
        if (Request.HasFormContentType)
        {
            var form = await Request.ReadFormAsync(ct);
            if (!Guid.TryParse(form["room_id"], out var roomId))
                return (null, null, null, BadRequest(new { error = "INVALID_ROOM_ID" }));

            Guid? parentId = null;
            var parentRaw = form["parent_id"].ToString();
            if (!string.IsNullOrWhiteSpace(parentRaw))
            {
                if (!Guid.TryParse(parentRaw, out var parsedParentId))
                    return (null, null, null, BadRequest(new { error = "INVALID_PARENT_ID" }));
                parentId = parsedParentId;
            }

            var body = form["body"].ToString();
            return (new PostMessageRequest(roomId, parentId, body), form.Files.GetFile("image"), form.Files.GetFile("video"), null);
        }

        var request = await Request.ReadFromJsonAsync<PostMessageRequest>(RequestJsonOptions, cancellationToken: ct);
        return request is null
            ? (null, null, null, BadRequest(new { error = "INVALID_MESSAGE_REQUEST" }))
            : (request, null, null, null);
    }
}
