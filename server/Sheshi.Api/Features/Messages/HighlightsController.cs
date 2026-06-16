using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Sheshi.Api.Auth;
using Sheshi.Api.Data;

namespace Sheshi.Api.Features.Messages;

[ApiController]
[Route("api/highlights")]
public class HighlightsController(AppDbContext db, MessageService messageService, IMemoryCache cache) : ControllerBase
{
    [EnableRateLimiting("reads")]
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<MessageDto>>> List([FromQuery] string mode = "hot", CancellationToken ct = default)
    {
        mode = mode.ToLowerInvariant();
        if (mode is not ("hot" or "top" or "replied")) return BadRequest(new { error = "INVALID_MODE" });

        // The ranking query is the expensive, scraper-exposed part. Cache it for 30s — but ONLY for
        // anonymous callers, because the cached DTOs carry my_vote=0. Authenticated requests compute
        // fresh so a signed-in reader still sees their own vote on a highlighted post (the cache key
        // is shared, so caching the authed result would leak/zero votes across users). Realtime pushes
        // keep connected clients fresh within seconds; the 30s cache only blunts cold/SSR load bursts.
        var callerId = User.GetUserId();
        var cacheKey = $"highlights:{mode}";
        if (callerId is null && cache.TryGetValue(cacheKey, out IReadOnlyList<MessageDto>? cached) && cached is not null)
            return Ok(cached);

        var topLevel = db.Messages
            .AsNoTracking()
            .Where(m => m.ParentId == null && m.DeletedAt == null);

        // Pick candidates ranked by the RANKING metric (in the DB), not by recency — otherwise a
        // high-scoring/high-reply post outside the newest-N window is silently dropped.
        List<Guid> candidateIds;
        if (mode == "hot")
        {
            // Hot is engagement-first now, so candidates are the top 200 by raw engagement (vote sum +
            // reply count) over the last 7 days — not merely the newest, which silently dropped engaged
            // posts once volume was high. Final ordering is applied by HotScore below.
            var since = DateTimeOffset.UtcNow.AddDays(-7);
            candidateIds = await topLevel
                .Where(m => m.CreatedAt >= since)
                .OrderByDescending(m =>
                    db.Votes.Where(v => v.MessageId == m.Id).Sum(v => (int)v.Value)
                    + db.Messages.Count(c => c.ParentId == m.Id && c.DeletedAt == null))
                .ThenByDescending(m => m.CreatedAt)
                .Take(200)
                .Select(m => m.Id)
                .ToListAsync(ct);
        }
        else
        {
            var since = DateTimeOffset.UtcNow.AddHours(-24);
            var windowed = topLevel.Where(m => m.CreatedAt >= since);
            candidateIds = mode == "top"
                ? await windowed
                    .OrderByDescending(m => db.Votes.Where(v => v.MessageId == m.Id).Sum(v => (int)v.Value))
                    .ThenByDescending(m => m.CreatedAt)
                    .Take(50).Select(m => m.Id).ToListAsync(ct)
                : await windowed
                    .OrderByDescending(m => db.Messages.Count(c => c.ParentId == m.Id && c.DeletedAt == null))
                    .ThenByDescending(m => m.CreatedAt)
                    .Take(50).Select(m => m.Id).ToListAsync(ct);
        }

        var candidates = await db.Messages.AsNoTracking().Where(m => candidateIds.Contains(m.Id)).ToListAsync(ct);
        var enriched = await messageService.EnrichAsync(candidates, callerId, ct);
        var now = DateTimeOffset.UtcNow;
        var ranked = mode switch
        {
            "hot" => enriched.OrderByDescending(m => HotScore(m, now)).ThenByDescending(m => m.CreatedAt),
            "top" => enriched.OrderByDescending(m => m.Score).ThenByDescending(m => m.CreatedAt),
            _ => enriched.OrderByDescending(m => m.ReplyCount).ThenByDescending(m => m.CreatedAt)
        };

        var result = (IReadOnlyList<MessageDto>)ranked.Take(10).ToList();
        if (callerId is null)
            cache.Set(cacheKey, result, new MemoryCacheEntryOptions
            {
                AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(30)
            });
        return Ok(result);
    }

    // "Hot" = engagement-first with a delayed, gentle time decay (see
    // docs/2026-06-14-hot-engagement-ranking-design.md). Within the first GraceHours the rank is pure
    // engagement (votes + comments, comments weighted a bit more); after a day a gentle gravity decay
    // applies so age matters only mildly. Zero-engagement scores 0 (can't lead); downvoted goes
    // negative and sinks.
    private const double CommentWeight = 1.5; // a comment counts a bit more than an upvote
    private const double GraceHours = 24.0;   // no time decay for the first day
    private const double DecayGravity = 0.8;  // gentle decay afterwards (Reddit/HN use ~1.8)

    private static double HotScore(MessageDto m, DateTimeOffset now)
    {
        var engagement = m.Score + CommentWeight * m.ReplyCount;
        var ageHours = Math.Max(0.0001, (now - m.CreatedAt).TotalHours);
        var recency = Math.Min(1.0, Math.Pow(GraceHours / ageHours, DecayGravity));
        return engagement * recency;
    }
}
