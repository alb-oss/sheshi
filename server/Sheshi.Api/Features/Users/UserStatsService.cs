using Microsoft.EntityFrameworkCore;
using Sheshi.Api.Data;

namespace Sheshi.Api.Features.Users;

// Computes a user's karma on read from existing votes/messages — no denormalized column, so it can
// never drift. Upvotes are the dominant lever (weighted, and they compound for popular users); every
// non-deleted contribution (post or reply) also adds a point so activity counts. Tunable here; this
// is the value that will later feed the Në Fokus/HOT ranking.
public class UserStatsService(AppDbContext db)
{
    private const int UpvoteWeight = 2;
    private const int ContributionWeight = 1;

    public async Task<int> GetKarmaAsync(Guid userId, CancellationToken ct = default)
    {
        // Net votes received across the user's non-deleted messages (up = +1, down = -1).
        var netVotes = await db.Votes
            .Where(v => v.Message.AuthorId == userId && v.Message.DeletedAt == null)
            .SumAsync(v => (int)v.Value, ct);

        var contributions = await db.Messages
            .CountAsync(m => m.AuthorId == userId && m.DeletedAt == null, ct);

        return UpvoteWeight * netVotes + ContributionWeight * contributions;
    }
}
