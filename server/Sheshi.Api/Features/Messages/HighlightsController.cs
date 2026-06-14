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
        var now = DateTimeOffset.UtcNow;
        var ranked = mode switch
        {
            "hot" => enriched.OrderByDescending(m => HotScore(m, now)).ThenByDescending(m => m.CreatedAt),
            "top" => enriched.OrderByDescending(m => m.Score).ThenByDescending(m => m.CreatedAt),
            _ => enriched.OrderByDescending(m => m.ReplyCount).ThenByDescending(m => m.CreatedAt)
        };

        return Ok(ranked.Take(10).ToList());
    }

    // "Hot" = engagement decayed by age (Hacker-News style gravity). Engagement is the net vote
    // score plus replies at half a vote each, so a thread with zero votes AND zero replies scores
    // 0 and cannot top the list purely by being newest (the old Reddit-epoch formula was recency-
    // dominated for low scores). A downvoted post goes negative and sinks; gravity 1.5 still lets a
    // fresh, engaged post outrank an older one.
    private static double HotScore(MessageDto m, DateTimeOffset now)
    {
        var engagement = m.Score + 0.5 * m.ReplyCount;
        var ageHours = Math.Max(0, (now - m.CreatedAt).TotalHours);
        return engagement / Math.Pow(ageHours + 2.0, 1.5);
    }
}
