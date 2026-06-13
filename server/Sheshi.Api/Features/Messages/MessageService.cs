using Microsoft.EntityFrameworkCore;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Features.Messages;

public class MessageService(AppDbContext db)
{
    private const int DefaultRoomLimit = 40;
    private const int DefaultReplyLimit = 80;
    private const int MaxLimit = 100;

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

        return messages.Select(m => new MessageDto(
            m.Id,
            m.RoomId,
            m.AuthorId,
            m.ParentId,
            m.Body,
            m.ImageUrl,
            m.DeletedAt,
            m.CreatedAt,
            authors.GetValueOrDefault(m.AuthorId),
            upvotes.GetValueOrDefault(m.Id),
            replyCounts.GetValueOrDefault(m.Id),
            voted.Contains(m.Id))).ToList();
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
        return long.TryParse(cursor, out var ticks)
            ? new DateTimeOffset(ticks, TimeSpan.Zero)
            : null;
    }
}
