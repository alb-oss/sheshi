using Microsoft.EntityFrameworkCore;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Features.Messages;

/// <summary>
/// Projects <see cref="Message"/> entities into <see cref="MessageDto"/>s,
/// batch-loading authors, vote totals, reply counts, and the caller's own
/// votes in four queries (no N+1). Soft-deleted messages keep their position
/// in the tree but never expose their original body or image.
/// </summary>
public class MessageEnricher(AppDbContext db)
{
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
            m.EffectiveRootId,
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
}
