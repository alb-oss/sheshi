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

        var query = db.Messages
            .AsNoTracking()
            .Where(m => m.ParentId == null && m.DeletedAt == null);

        if (mode is not "hot")
        {
            var since = DateTimeOffset.UtcNow.AddHours(-24);
            query = query.Where(m => m.CreatedAt >= since);
        }

        var candidates = await query
            .OrderByDescending(m => m.CreatedAt)
            .Take(200)
            .ToListAsync(ct);

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
