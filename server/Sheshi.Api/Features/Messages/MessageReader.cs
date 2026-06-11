using Microsoft.EntityFrameworkCore;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Features.Messages;

/// <summary>
/// Read side of the message feature: room feeds, single messages, reply pages,
/// and full thread trees, all keyset-paginated and enriched. Commands live in
/// <see cref="MessageService"/>.
/// </summary>
public class MessageReader(AppDbContext db, MessageEnricher enricher)
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

        return (await enricher.EnrichAsync([message], callerId, ct)).Single();
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

        var rootId = await ResolveRootAsync(db, requested, ct);
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

        var enriched = await enricher.EnrichAsync(threadMessages, callerId, ct);
        var enrichedById = enriched.ToDictionary(m => m.Id);
        var nodes = BuildReplyNodes(root.Id, repliesByParent, enrichedById, 1);

        return new ThreadDto(enrichedById[root.Id], nodes);
    }

    /// <summary>
    /// Walks parents to find a thread's root id, preferring the stored
    /// <see cref="Message.RootMessageId"/> and guarding against cycles. Shared
    /// by reads and by the command side's realtime notifications.
    /// </summary>
    public static async Task<Guid> ResolveRootAsync(AppDbContext db, Message message, CancellationToken ct)
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
        return new CursorPageDto<MessageDto>(await enricher.EnrichAsync(pageRows, callerId, ct), nextCursor);
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
