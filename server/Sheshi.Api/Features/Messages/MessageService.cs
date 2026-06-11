using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;
using Sheshi.Api.Realtime;
using Sheshi.Api.Storage;

namespace Sheshi.Api.Features.Messages;

public class MessageService(AppDbContext db, IImageStorage imageStorage, RealtimeNotifier realtime, IMemoryCache cache)
{
    private const int DefaultRoomLimit = 40;
    private const int DefaultReplyLimit = 80;
    private const int MaxLimit = 100;
    private const int MaxThreadMessages = 1000;

    public async Task<CursorPageDto<MessageDto>> ListRoomMessagesAsync(
        Guid roomId,
        Guid? callerId,
        int limit,
        string? cursor,
        CancellationToken ct = default)
    {
        var take = NormalizeLimit(limit, DefaultRoomLimit);
        var cursorCreatedAt = DecodeCursor(cursor);

        var query = db.Messages
            .AsNoTracking()
            .Where(m => m.RoomId == roomId && m.ParentId == null);

        if (cursorCreatedAt is not null)
            query = query.Where(m => m.CreatedAt < cursorCreatedAt);

        var messages = await query
            .OrderByDescending(m => m.CreatedAt)
            .ThenByDescending(m => m.Id)
            .Take(take + 1)
            .ToListAsync(ct);

        return await ToCursorPageAsync(messages, take, callerId, ct);
    }

    public async Task<MessageDto?> GetMessageAsync(Guid id, Guid? callerId, CancellationToken ct = default)
    {
        var message = await db.Messages.AsNoTracking().SingleOrDefaultAsync(m => m.Id == id, ct);
        if (message is null) return null;

        return (await EnrichAsync([message], callerId, ct)).Single();
    }

    public async Task<CursorPageDto<MessageDto>> ListRepliesAsync(
        Guid parentId,
        Guid? callerId,
        int limit,
        string? cursor,
        CancellationToken ct = default)
    {
        var take = NormalizeLimit(limit, DefaultReplyLimit);
        var cursorCreatedAt = DecodeCursor(cursor);

        var query = db.Messages
            .AsNoTracking()
            .Where(m => m.ParentId == parentId);

        if (cursorCreatedAt is not null)
            query = query.Where(m => m.CreatedAt > cursorCreatedAt);

        var replies = await query
            .OrderBy(m => m.CreatedAt)
            .ThenBy(m => m.Id)
            .Take(take + 1)
            .ToListAsync(ct);

        return await ToCursorPageAsync(replies, take, callerId, ct);
    }

    public async Task<ThreadDto?> GetThreadAsync(Guid id, Guid? callerId, CancellationToken ct = default)
    {
        var requested = await db.Messages.AsNoTracking().SingleOrDefaultAsync(m => m.Id == id, ct);
        if (requested is null) return null;

        var rootId = await GetThreadRootIdAsync(requested, ct);
        var threadMessages = await db.Messages
            .AsNoTracking()
            .Where(m => m.RootMessageId == rootId || m.Id == rootId)
            .OrderBy(m => m.Depth)
            .ThenBy(m => m.CreatedAt)
            .ThenBy(m => m.Id)
            .Take(MaxThreadMessages)
            .ToListAsync(ct);

        var root = threadMessages.FirstOrDefault(m => m.Id == rootId);
        if (root is null)
        {
            root = await db.Messages.AsNoTracking().SingleOrDefaultAsync(m => m.Id == rootId, ct);
            if (root is null) return null;
            threadMessages.Insert(0, root);
        }

        var repliesByParent = threadMessages
            .Where(m => m.ParentId is not null)
            .GroupBy(m => m.ParentId!.Value)
            .ToDictionary(g => g.Key, g => g.OrderBy(m => m.CreatedAt).ThenBy(m => m.Id).ToList());

        var enriched = await EnrichAsync(threadMessages, callerId, ct);
        var enrichedById = enriched.ToDictionary(m => m.Id);
        var nodes = BuildReplyNodes(root.Id, repliesByParent, enrichedById, 1);

        return new ThreadDto(enrichedById[root.Id], nodes);
    }

    public async Task<MessageCreateResult> CreateMessageAsync(
        Guid authorId,
        PostMessageRequest request,
        IFormFile? image,
        CancellationToken ct = default)
    {
        var body = request.Body?.Trim() ?? "";
        if (body.Length == 0) return MessageCreateResult.Failed("EMPTY");
        if (body.Length > 2000) return MessageCreateResult.Failed("TOO_LONG");
        request = request with { Body = body };

        if (!await db.Rooms.AnyAsync(r => r.Id == request.RoomId, ct))
            return MessageCreateResult.Failed("ROOM_NOT_FOUND");

        Message? parent = null;
        if (request.ParentId is not null)
        {
            parent = await db.Messages.AsNoTracking().SingleOrDefaultAsync(m => m.Id == request.ParentId, ct);
            if (parent is null) return MessageCreateResult.Failed("PARENT_NOT_FOUND");
            if (parent.RoomId != request.RoomId) return MessageCreateResult.Failed("PARENT_ROOM_MISMATCH");
        }

        string? imageUrl = null;
        if (image is not null && image.Length > 0)
        {
            try
            {
                await using var stream = image.OpenReadStream();
                imageUrl = await imageStorage.SaveAsync(stream, image.ContentType, ct);
            }
            catch (ImageStorageException ex)
            {
                return MessageCreateResult.Failed(ex.Code);
            }
        }

        var message = new Message
        {
            Id = Guid.NewGuid(),
            RoomId = request.RoomId,
            AuthorId = authorId,
            ParentId = request.ParentId,
            RootMessageId = parent is null ? Guid.Empty : parent.RootMessageId == Guid.Empty ? parent.Id : parent.RootMessageId,
            Depth = parent is null ? 0 : parent.Depth + 1,
            Body = request.Body.Trim(),
            ImageUrl = imageUrl
        };
        if (parent is null) message.RootMessageId = message.Id;

        db.Messages.Add(message);
        await db.SaveChangesAsync(ct);

        var dto = (await EnrichAsync([message], authorId, ct)).Single();
        cache.Remove(HighlightsCache.Key);
        await realtime.MessageChangedAsync(
            new MessageChangeDto("message.created", message.RoomId, message.RootMessageId, message.Id),
            ct);
        return MessageCreateResult.Created(message, dto);
    }

    public async Task<bool> UpvoteAsync(Guid messageId, Guid userId, CancellationToken ct = default)
    {
        var message = await db.Messages.AsNoTracking().SingleOrDefaultAsync(m => m.Id == messageId, ct);
        if (message is null) return false;

        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "Votes" ("MessageId", "UserId", "CreatedAt")
            VALUES ({messageId}, {userId}, {DateTimeOffset.UtcNow})
            ON CONFLICT ("MessageId", "UserId") DO NOTHING
            """, ct);

        cache.Remove(HighlightsCache.Key);
        await realtime.MessageChangedAsync(
            new MessageChangeDto("vote.changed", message.RoomId, await GetThreadRootIdAsync(message, ct), message.Id),
            ct);
        return true;
    }

    public async Task RemoveUpvoteAsync(Guid messageId, Guid userId, CancellationToken ct = default)
    {
        var vote = await db.Votes
            .Include(v => v.Message)
            .SingleOrDefaultAsync(v => v.MessageId == messageId && v.UserId == userId, ct);
        if (vote is null) return;

        var change = new MessageChangeDto(
            "vote.changed",
            vote.Message.RoomId,
            await GetThreadRootIdAsync(vote.Message, ct),
            vote.MessageId);

        db.Votes.Remove(vote);
        await db.SaveChangesAsync(ct);
        cache.Remove(HighlightsCache.Key);
        await realtime.MessageChangedAsync(change, ct);
    }

    public async Task<DeleteMessageResult> SoftDeleteAsync(
        Guid messageId,
        Guid userId,
        bool canModerate,
        CancellationToken ct = default)
    {
        var message = await db.Messages.SingleOrDefaultAsync(m => m.Id == messageId, ct);
        if (message is null) return DeleteMessageResult.NotFound();
        if (message.AuthorId != userId && !canModerate) return DeleteMessageResult.Forbidden();

        message.DeletedAt ??= DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);

        var change = new MessageChangeDto(
            "message.deleted",
            message.RoomId,
            await GetThreadRootIdAsync(message, ct),
            message.Id);
        cache.Remove(HighlightsCache.Key);
        await realtime.MessageChangedAsync(change, ct);
        return DeleteMessageResult.Deleted(change);
    }

    public async Task<ReportMessageResult> ReportAsync(
        Guid messageId,
        Guid reporterId,
        ReportMessageRequest request,
        CancellationToken ct = default)
    {
        if (!await db.Messages.AnyAsync(m => m.Id == messageId, ct))
            return ReportMessageResult.NotFound();
        if ((request.Note?.Length ?? 0) > 500)
            return ReportMessageResult.Failed("NOTE_TOO_LONG");

        db.Reports.Add(new Report
        {
            MessageId = messageId,
            ReporterId = reporterId,
            Reason = request.Reason,
            Note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim()
        });
        await db.SaveChangesAsync(ct);

        return ReportMessageResult.Created();
    }

    public async Task<IReadOnlyList<MessageDto>> EnrichAsync(
        IReadOnlyList<Message> messages,
        Guid? callerId,
        CancellationToken ct = default)
    {
        if (messages.Count == 0) return [];

        var ids = messages.Select(m => m.Id).ToArray();
        var authorIds = messages.Select(m => m.AuthorId).Distinct().ToArray();

        var authors = await db.Users
            .AsNoTracking()
            .Where(u => authorIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => new AuthorDto(u.Id, u.UserName, u.DisplayName, u.AvatarUrl), ct);

        var upvotes = await db.Votes
            .AsNoTracking()
            .Where(v => ids.Contains(v.MessageId))
            .GroupBy(v => v.MessageId)
            .Select(g => new { MessageId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.MessageId, x => x.Count, ct);

        var replyCounts = await db.Messages
            .AsNoTracking()
            .Where(m => m.ParentId != null && ids.Contains(m.ParentId.Value) && m.DeletedAt == null)
            .GroupBy(m => m.ParentId!.Value)
            .Select(g => new { MessageId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.MessageId, x => x.Count, ct);

        var voted = callerId is null
            ? new HashSet<Guid>()
            : await db.Votes
                .AsNoTracking()
                .Where(v => v.UserId == callerId && ids.Contains(v.MessageId))
                .Select(v => v.MessageId)
                .ToHashSetAsync(ct);

        // Soft-deleted messages keep their place in the tree but must never
        // expose the original content through the API.
        return messages.Select(m => new MessageDto(
            m.Id,
            m.RoomId,
            m.AuthorId,
            m.ParentId,
            m.RootMessageId == Guid.Empty && m.ParentId is null ? m.Id : m.RootMessageId,
            m.Depth,
            m.DeletedAt is null ? m.Body : "",
            m.DeletedAt is null ? m.ImageUrl : null,
            m.DeletedAt,
            m.CreatedAt,
            authors.GetValueOrDefault(m.AuthorId),
            upvotes.GetValueOrDefault(m.Id),
            replyCounts.GetValueOrDefault(m.Id),
            voted.Contains(m.Id))).ToList();
    }

    private async Task<Guid> GetThreadRootIdAsync(Message message, CancellationToken ct)
    {
        if (message.ParentId is null) return message.Id;
        if (message.RootMessageId != Guid.Empty) return message.RootMessageId;

        var current = message;
        var seen = new HashSet<Guid> { current.Id };

        while (current.ParentId is Guid parentId && seen.Add(parentId))
        {
            var parent = await db.Messages.AsNoTracking().SingleOrDefaultAsync(m => m.Id == parentId, ct);
            if (parent is null) break;
            current = parent;
        }

        return current.Id;
    }

    private async Task<CursorPageDto<MessageDto>> ToCursorPageAsync(
        List<Message> rows,
        int take,
        Guid? callerId,
        CancellationToken ct)
    {
        var hasMore = rows.Count > take;
        var pageRows = hasMore ? rows.Take(take).ToList() : rows;
        var nextCursor = hasMore && pageRows.Count > 0 ? EncodeCursor(pageRows[^1].CreatedAt) : null;
        return new CursorPageDto<MessageDto>(await EnrichAsync(pageRows, callerId, ct), nextCursor);
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

    private static int NormalizeLimit(int requested, int fallback)
    {
        if (requested <= 0) return fallback;
        return Math.Min(requested, MaxLimit);
    }

    private static string EncodeCursor(DateTimeOffset createdAt) => createdAt.UtcTicks.ToString();

    private static DateTimeOffset? DecodeCursor(string? cursor)
    {
        return long.TryParse(cursor, out var ticks)
            ? new DateTimeOffset(ticks, TimeSpan.Zero)
            : null;
    }
}

public sealed record MessageCreateResult(Message? Entity, MessageDto? Dto, string? Error)
{
    public static MessageCreateResult Created(Message entity, MessageDto dto) => new(entity, dto, null);
    public static MessageCreateResult Failed(string error) => new(null, null, error);
}

public sealed record DeleteMessageResult(bool Found, bool Authorized, MessageChangeDto? Change)
{
    public static DeleteMessageResult NotFound() => new(false, false, null);
    public static DeleteMessageResult Forbidden() => new(true, false, null);
    public static DeleteMessageResult Deleted(MessageChangeDto change) => new(true, true, change);
}

public sealed record ReportMessageResult(bool Found, bool Succeeded, string? Error)
{
    public static ReportMessageResult NotFound() => new(false, false, null);
    public static ReportMessageResult Failed(string error) => new(true, false, error);
    public static ReportMessageResult Created() => new(true, true, null);
}
