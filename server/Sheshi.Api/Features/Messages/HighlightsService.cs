using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Features.Messages;

/// <summary>Tunable weights for the highlight ranking, bound from the "Highlights"
/// config section so ranking can be adjusted without a redeploy.</summary>
public class HighlightsOptions
{
    public double ReplyWeight { get; set; } = 30;       // per UNIQUE direct replier (anti reply-farming)
    public double DescendantsWeight { get; set; } = 18; // log-scaled subtree size
    public double UpvoteWeight { get; set; } = 12;
    public double BranchVoteWeight { get; set; } = 8;   // log-scaled thread-wide votes
    public double BranchBonus { get; set; } = 18;       // a reply that itself sparked discussion
    public double ActivityRecency { get; set; } = 42;
    public double CreatedRecency { get; set; } = 14;
}

/// <summary>
/// Shared cache key for the highlights snapshot. Writes that affect the
/// ranking (post/vote/delete) evict it so readers never wait on the TTL.
/// </summary>
public static class HighlightsCache
{
    public const string Key = "highlights:snapshot:v1";
}

public sealed record HighlightSnapshot(
    IReadOnlyList<Message> Candidates,
    IReadOnlyDictionary<Guid, HighlightStats> Stats);

public sealed class HighlightStats(Message message, int upvotes, int directReplies, DateTimeOffset activityAt)
{
    public Message Message { get; } = message;
    public int Upvotes { get; } = upvotes;
    public int DirectReplies { get; } = directReplies;
    public int BranchVotes { get; set; }
    public int Descendants { get; set; }
    public int UniqueRepliers { get; set; }
    public DateTimeOffset ActivityAt { get; set; } = activityAt;
}

/// <summary>
/// Builds and caches the activity snapshot behind "ne fokus" rankings and the
/// admin "top posts" panel. The expensive scan runs at most once per TTL (or
/// once per ranking-relevant write) and is shared by every reader.
/// </summary>
public class HighlightsService(AppDbContext db, IMemoryCache cache, IOptions<HighlightsOptions> options)
{
    private readonly HighlightsOptions _options = options.Value;
    private const int SeedLimit = 2000;
    private const int BranchLimit = 5000;
    private static readonly TimeSpan SeedWindow = TimeSpan.FromDays(7);
    private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(30);
    private static readonly SemaphoreSlim SnapshotGate = new(1, 1);

    public async Task<HighlightSnapshot> GetSnapshotAsync(CancellationToken ct = default)
    {
        if (cache.TryGetValue(HighlightsCache.Key, out HighlightSnapshot? cached) && cached is not null)
            return cached;

        // Single-flight: under load only one request pays for the recompute.
        await SnapshotGate.WaitAsync(ct);
        try
        {
            if (cache.TryGetValue(HighlightsCache.Key, out cached) && cached is not null)
                return cached;

            var candidates = await LoadCandidatesAsync(ct);
            var stats = await LoadStatsAsync(candidates, ct);
            var snapshot = new HighlightSnapshot(candidates, stats);
            cache.Set(HighlightsCache.Key, snapshot, CacheTtl);
            return snapshot;
        }
        finally
        {
            SnapshotGate.Release();
        }
    }

    /// <summary>
    /// The ranking score: discussion (weighted by UNIQUE repliers so one account
    /// can't farm it) + votes + a recency decay. Weights come from
    /// <see cref="HighlightsOptions"/>. The frontend keeps a deliberately
    /// simplified mirror in appSupport.ts (hotScore) for client-side re-sorting.
    /// </summary>
    public double Score(HighlightStats stats, DateTimeOffset now)
    {
        var ageHours = Math.Max((now - stats.ActivityAt).TotalHours, 0.25);
        var createdAgeHours = Math.Max((now - stats.Message.CreatedAt).TotalHours, 0.25);
        var isReply = stats.Message.ParentId is not null;

        var discussion = stats.UniqueRepliers * _options.ReplyWeight
            + Math.Log2(stats.Descendants + 1) * _options.DescendantsWeight;
        var votes = stats.Upvotes * _options.UpvoteWeight
            + Math.Log2(stats.BranchVotes + 1) * _options.BranchVoteWeight;
        var branchBonus = isReply && stats.DirectReplies + stats.Descendants > 0 ? _options.BranchBonus : 0;
        var recency = _options.ActivityRecency / Math.Pow(ageHours + 1, 0.95)
            + _options.CreatedRecency / Math.Pow(createdAgeHours + 1, 0.45);

        return discussion + votes + branchBonus + recency;
    }

    public static double FreshTieBreakScore(HighlightStats stats) =>
        stats.DirectReplies * 6 + stats.Descendants * 2 + stats.Upvotes * 3 + stats.BranchVotes;

    private async Task<IReadOnlyList<Message>> LoadCandidatesAsync(CancellationToken ct)
    {
        // Seed by activity window instead of a fixed "last N messages": on a busy
        // site 500 recent rows may only cover minutes, dropping still-hot threads.
        var windowStart = DateTimeOffset.UtcNow - SeedWindow;
        var seeds = await db.Messages
            .AsNoTracking()
            .Where(m => m.DeletedAt == null && m.CreatedAt >= windowStart)
            .OrderByDescending(m => m.CreatedAt)
            .Take(SeedLimit)
            .ToListAsync(ct);

        if (seeds.Count == 0) return [];

        var candidateIds = seeds
            .Select(m => m.Id)
            .Concat(seeds.Where(m => m.ParentId is not null).Select(m => m.ParentId!.Value))
            .Concat(seeds.Select(m => m.EffectiveRootId).Where(id => id != Guid.Empty))
            .Distinct()
            .ToArray();

        return await db.Messages
            .AsNoTracking()
            .Where(m => candidateIds.Contains(m.Id) && m.DeletedAt == null)
            .ToListAsync(ct);
    }

    private async Task<IReadOnlyDictionary<Guid, HighlightStats>> LoadStatsAsync(
        IReadOnlyList<Message> candidates,
        CancellationToken ct)
    {
        if (candidates.Count == 0) return new Dictionary<Guid, HighlightStats>();

        var candidateIds = candidates.Select(m => m.Id).ToHashSet();
        var rootIds = candidates
            .Select(m => m.EffectiveRootId)
            .Where(id => id != Guid.Empty)
            .Distinct()
            .ToArray();

        var branchMessages = await db.Messages
            .AsNoTracking()
            .Where(m => m.DeletedAt == null && (rootIds.Contains(m.RootMessageId) || rootIds.Contains(m.Id)))
            .OrderByDescending(m => m.CreatedAt)
            .Take(BranchLimit)
            .ToListAsync(ct);

        var branchMessageIds = branchMessages.Select(m => m.Id).ToHashSet();
        var upvotes = await db.Votes
            .AsNoTracking()
            .Where(v => branchMessageIds.Contains(v.MessageId))
            .GroupBy(v => v.MessageId)
            .Select(g => new { MessageId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.MessageId, x => x.Count, ct);

        var directRepliesByParent = branchMessages
            .Where(m => m.ParentId is not null && candidateIds.Contains(m.ParentId.Value))
            .GroupBy(m => m.ParentId!.Value)
            .ToDictionary(g => g.Key, g => g.ToList());
        var directReplies = directRepliesByParent.ToDictionary(kvp => kvp.Key, kvp => kvp.Value.Count);
        var uniqueRepliers = directRepliesByParent.ToDictionary(
            kvp => kvp.Key, kvp => kvp.Value.Select(m => m.AuthorId).Distinct().Count());

        var byId = branchMessages.ToDictionary(m => m.Id);
        var stats = candidates.ToDictionary(
            m => m.Id,
            m => new HighlightStats(
                m,
                upvotes.GetValueOrDefault(m.Id),
                directReplies.GetValueOrDefault(m.Id),
                m.CreatedAt)
            {
                UniqueRepliers = uniqueRepliers.GetValueOrDefault(m.Id)
            });

        foreach (var message in branchMessages)
        {
            var parentId = message.ParentId;
            var seen = new HashSet<Guid>();
            var messageVotes = upvotes.GetValueOrDefault(message.Id);
            while (parentId is Guid id && seen.Add(id) && byId.TryGetValue(id, out var parent))
            {
                if (stats.TryGetValue(id, out var stat))
                {
                    stat.Descendants += 1;
                    stat.BranchVotes += messageVotes;
                    if (message.CreatedAt > stat.ActivityAt) stat.ActivityAt = message.CreatedAt;
                }

                parentId = parent.ParentId;
            }
        }

        return stats;
    }
}
