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
        var now = DateTimeOffset.UtcNow;
        var ranked = mode switch
        {
            "hot" => enriched.OrderByDescending(m => HotScore(m, now)),
            "top" => enriched.OrderByDescending(m => m.Upvotes).ThenByDescending(m => m.CreatedAt),
            _ => enriched.OrderByDescending(m => m.ReplyCount).ThenByDescending(m => m.CreatedAt)
        };

        return Ok(ranked.Take(10).ToList());
    }

    private static double HotScore(MessageDto message, DateTimeOffset now)
    {
        var ageHours = Math.Max((now - message.CreatedAt).TotalHours, 0.5);
        return (message.Upvotes + message.ReplyCount * 2) / Math.Pow(ageHours, 1.3);
    }
}
