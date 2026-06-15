using Microsoft.EntityFrameworkCore;
using Sheshi.Api.Data;

namespace Sheshi.Api.Features.Users;

// Computes a user's karma on read from existing votes — no denormalized column, so it can never drift.
// Karma is earned ONLY from upvotes by OTHER users on the user's non-deleted messages: posting earns
// nothing, self-votes are excluded, and the per-message contribution is dampened (see KarmaCurve) so a
// viral post can't mint karma. This makes karma hard to gather and farm-resistant.
public class UserStatsService(AppDbContext db)
{
    public async Task<int> GetKarmaAsync(Guid userId, CancellationToken ct = default)
    {
        // Net votes per message, from OTHER users only (self-votes excluded), over non-deleted messages.
        var perMessage = await db.Votes
            .Where(v => v.Message.AuthorId == userId && v.Message.DeletedAt == null && v.UserId != userId)
            .GroupBy(v => v.MessageId)
            .Select(g => g.Sum(v => (int)v.Value))
            .ToListAsync(ct);

        return KarmaCurve.Total(perMessage);
    }
}
