using Microsoft.EntityFrameworkCore;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Features.Messages;

public class MessageService(AppDbContext db)
{
    private const int DefaultRoomLimit = 40;
    private const int DefaultReplyLimit = 80;
    private const int MaxLimit = 100;
    private const int MediaCap = 1000;

    // All non-deleted media in a room (images + videos), chronological, for the swipeable gallery.
    // Capped at the most recent MediaCap items.
    public async Task<IReadOnlyList<MediaDto>> ListRoomMediaAsync(Guid roomId, CancellationToken ct = default)
    {
        var rows = await db.Messages
            .AsNoTracking()
            .Where(m => m.RoomId == roomId && m.DeletedAt == null && (m.ImageUrl != null || m.VideoUrl != null))
            .OrderByDescending(m => m.CreatedAt)
            .ThenByDescending(m => m.Id)
            .Take(MediaCap)
            .Select(m => new MediaDto(
                m.Id,
                m.ImageUrl != null ? "image" : "video",
                m.ImageUrl ?? m.VideoUrl!,
                m.CreatedAt,
                m.Author.DisplayName ?? m.Author.UserName))
            .ToListAsync(ct);
        rows.Reverse(); // query is newest-first (for the cap); the gallery wants oldest-first.
        return rows;
    }

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

    // A user's own posts (ParentId == null) or comments (ParentId != null), newest-first, excluding
    // deleted — for the profile page. Same cursor scheme as the room feed.
    public async Task<CursorPageDto<MessageDto>> ListUserMessagesAsync(
        Guid authorId,
        bool comments,
        Guid? callerId,
        int limit,
        string? cursor,
        CancellationToken ct = default)
    {
        var take = NormalizeLimit(limit, DefaultRoomLimit);
        var cursorCreatedAt = DecodeCursor(cursor);

        var query = db.Messages
            .AsNoTracking()
            .Where(m => m.AuthorId == authorId && m.DeletedAt == null &&
                        (comments ? m.ParentId != null : m.ParentId == null));

        if (cursorCreatedAt is not null)
            query = query.Where(m => m.CreatedAt < cursorCreatedAt);

        var messages = await query
            .OrderByDescending(m => m.CreatedAt)
            .ThenByDescending(m => m.Id)
            .Take(take + 1)
            .ToListAsync(ct);

        return await ToCursorPageAsync(messages, take, callerId, ct);
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

        var scores = await db.Votes
            .AsNoTracking()
            .Where(v => ids.Contains(v.MessageId))
            .GroupBy(v => v.MessageId)
            .Select(g => new { MessageId = g.Key, Score = g.Sum(v => (int)v.Value) })
            .ToDictionaryAsync(x => x.MessageId, x => x.Score, ct);

        // Reply count = the FULL subtree size (sub-replies included), not just direct children,
        // so a thread's count matches what the thread view shows and the live feed's per-reply
        // increment. Computed for every enriched message (a reply also reports its own subtree).
        var replyCounts = await LoadDescendantCountsAsync(ids, ct);

        var myVotes = callerId is null
            ? new Dictionary<Guid, int>()
            : await db.Votes
                .AsNoTracking()
                .Where(v => v.UserId == callerId && ids.Contains(v.MessageId))
                .Select(v => new { v.MessageId, Value = (int)v.Value })
                .ToDictionaryAsync(x => x.MessageId, x => x.Value, ct);

        // Tombstone soft-deleted messages at the DTO boundary: a deleted row stays in the tree
        // (so thread structure, reply_count, score, my_vote and the "[deleted]" UI are unchanged),
        // but its user-authored content must NOT be served on any public read. EnrichAsync is the
        // SINGLE MessageDto-construction site every read path funnels through (room feed, single
        // message, replies, thread, highlights), so masking here covers them all. Fail-closed:
        // DeletedAt != null ⇒ Body = "", ImageUrl/VideoUrl = null.
        return messages.Select(m =>
        {
            var deleted = m.DeletedAt != null;
            return new MessageDto(
                m.Id,
                m.RoomId,
                m.AuthorId,
                m.ParentId,
                deleted ? "" : m.Body,
                deleted ? null : m.ImageUrl,
                deleted ? null : m.VideoUrl,
                m.DeletedAt,
                m.CreatedAt,
                authors.GetValueOrDefault(m.AuthorId),
                scores.GetValueOrDefault(m.Id),
                replyCounts.GetValueOrDefault(m.Id),
                myVotes.GetValueOrDefault(m.Id));
        }).ToList();
    }

    private sealed record DescendantCount(Guid RootId, int Count);

    // Total descendants (all depths) under each given message. The model is an adjacency list
    // (ParentId only), so a recursive CTE walks down from each root. Deleted nodes are counted —
    // the thread tree keeps them ("[deleted]") and the live feed never decrements on delete, so
    // counting them keeps the badge, the thread header, and realtime in agreement.
    //
    // The recursion is hard-capped at 100 levels (carried in a depth column) so a single
    // pathologically deep chain can't make this walk — which runs on every enrich, on un-authenticated
    // reads — unbounded. The cap matches the in-memory thread walker's maxDepth (MessagesController);
    // counts on threads deeper than that are slightly under-reported, the same approximation the walker
    // already makes. The depth bound is inlined as a literal (a compile-time constant); only `ids` is
    // interpolated, which EF Core sends as a bind parameter.
    private async Task<Dictionary<Guid, int>> LoadDescendantCountsAsync(Guid[] ids, CancellationToken ct)
    {
        if (ids.Length == 0) return [];

        var rows = await db.Database
            .SqlQuery<DescendantCount>($@"
                WITH RECURSIVE descendants AS (
                    SELECT ""Id"" AS ""RootId"", ""Id"" AS node_id, 0 AS depth
                    FROM ""Messages""
                    WHERE ""Id"" = ANY({ids})
                    UNION ALL
                    SELECT d.""RootId"", m.""Id"", d.depth + 1
                    FROM ""Messages"" m
                    JOIN descendants d ON m.""ParentId"" = d.node_id
                    WHERE d.depth < 100
                )
                SELECT ""RootId"", (COUNT(*) - 1)::int AS ""Count""
                FROM descendants
                GROUP BY ""RootId""")
            .ToListAsync(ct);

        return rows.ToDictionary(r => r.RootId, r => r.Count);
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

    private static int NormalizeLimit(int requested, int fallback)
    {
        if (requested <= 0) return fallback;
        return Math.Min(requested, MaxLimit);
    }

    private static string EncodeCursor(DateTimeOffset createdAt) => createdAt.UtcTicks.ToString();

    private static DateTimeOffset? DecodeCursor(string? cursor)
    {
        // Fail closed: an out-of-range tick value would throw from the DateTimeOffset ctor
        // (HTTP 500 + stack leak). Range-check before constructing; treat bad cursors as none.
        if (!long.TryParse(cursor, out var ticks)) return null;
        if (ticks < DateTimeOffset.MinValue.UtcTicks || ticks > DateTimeOffset.MaxValue.UtcTicks) return null;
        return new DateTimeOffset(ticks, TimeSpan.Zero);
    }
}
