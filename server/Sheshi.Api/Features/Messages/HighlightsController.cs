using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Sheshi.Api.Auth;

namespace Sheshi.Api.Features.Messages;

[ApiController]
[Route("api/highlights")]
public class HighlightsController(HighlightsService highlights, MessageEnricher enricher) : ControllerBase
{
    private const int ResultLimit = 10;

    [HttpGet]
    [EnableRateLimiting("reads")]
    public async Task<ActionResult<IReadOnlyList<MessageDto>>> List([FromQuery] string mode = "hot", CancellationToken ct = default)
    {
        mode = mode.ToLowerInvariant();
        if (mode is not ("focus" or "hot" or "fresh" or "top" or "replied")) return BadRequest(new { error = "INVALID_MODE" });

        var snapshot = await highlights.GetSnapshotAsync(ct);
        var stats = snapshot.Stats;
        var now = DateTimeOffset.UtcNow;
        var ranked = mode switch
        {
            "fresh" => snapshot.Candidates
                .OrderByDescending(m => stats[m.Id].ActivityAt)
                .ThenByDescending(m => HighlightsService.FreshTieBreakScore(stats[m.Id])),
            "focus" or "hot" => snapshot.Candidates.OrderByDescending(m => highlights.Score(stats[m.Id], now)),
            "top" => snapshot.Candidates
                .OrderByDescending(m => stats[m.Id].Upvotes + stats[m.Id].BranchVotes)
                .ThenByDescending(m => stats[m.Id].DirectReplies + stats[m.Id].Descendants)
                .ThenByDescending(m => stats[m.Id].ActivityAt),
            _ => snapshot.Candidates
                .OrderByDescending(m => stats[m.Id].DirectReplies * 3 + stats[m.Id].Descendants)
                .ThenByDescending(m => stats[m.Id].ActivityAt)
        };

        // Rank on the cached stats, then enrich only the winners: the per-user
        // "voted" flag and author data stay fresh while the heavy scan is shared.
        var top = ranked.Take(ResultLimit).ToList();
        var enriched = await enricher.EnrichAsync(top, User.GetUserId(), ct);
        var byId = enriched.ToDictionary(m => m.Id);
        return Ok(top.Select(m => byId[m.Id]).ToList());
    }
}
