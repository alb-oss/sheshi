using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Sheshi.Api.Auth;
using Sheshi.Api.Data;

namespace Sheshi.Api.Features.Messages;

[ApiController]
[Route("api/highlights")]
public class HighlightsController(AppDbContext db, MessageService messageService) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<MessageDto>>> List([FromQuery] string mode = "hot", CancellationToken ct = default)
    {
        mode = mode.ToLowerInvariant();
        if (mode is not ("hot" or "top" or "replied")) return BadRequest(new { error = "INVALID_MODE" });

        var topLevel = db.Messages
            .AsNoTracking()
            .Where(m => m.ParentId == null && m.DeletedAt == null);

        // Pick candidates ranked by the RANKING metric (in the DB), not by recency — otherwise a
        // high-scoring/high-reply post outside the newest-N window is silently dropped.
        List<Guid> candidateIds;
        if (mode == "hot")
        {
            // Hot weights recency heavily, so the newest 200 (all-time) is a sound candidate pool.
            candidateIds = await topLevel
                .OrderByDescending(m => m.CreatedAt)
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
        var enriched = await messageService.EnrichAsync(candidates, User.GetUserId(), ct);
        var ranked = mode switch
        {
            "hot" => enriched.OrderByDescending(HotScore),
            "top" => enriched.OrderByDescending(m => m.Score).ThenByDescending(m => m.CreatedAt),
            _ => enriched.OrderByDescending(m => m.ReplyCount).ThenByDescending(m => m.CreatedAt)
        };

        return Ok(ranked.Take(10).ToList());
    }

    // Reddit's "hot" algorithm over the net score (up − down): sign- and time-weighted, so
    // rank decays with age and a downvoted post sinks below a zero-score one of the same age.
    private const long RedditEpoch = 1134028003L;
    private static double HotScore(MessageDto message)
    {
        var s = message.Score;
        var order = Math.Log10(Math.Max(Math.Abs(s), 1));
        var sign = Math.Sign(s);
        var seconds = message.CreatedAt.ToUnixTimeSeconds() - RedditEpoch;
        return sign * order + seconds / 45000.0;
    }
}
