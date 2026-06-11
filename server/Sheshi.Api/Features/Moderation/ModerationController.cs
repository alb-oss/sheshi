using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;
using Sheshi.Api.Features.Messages;

namespace Sheshi.Api.Features.Moderation;

[ApiController]
[Authorize(Roles = Roles.ModeratorOrAdmin)]
[EnableRateLimiting("moderation")]
[Route("api/mod")]
public class ModerationController(
    AppDbContext db,
    UserManager<ApplicationUser> userManager,
    HighlightsService highlights) : ControllerBase
{
    [HttpGet("analytics")]
    public async Task<ActionResult<ModAnalyticsDto>> Analytics(CancellationToken ct = default)
    {
        var now = DateTimeOffset.UtcNow;
        var since24 = now.AddHours(-24);
        var since7 = new DateTimeOffset(now.UtcDateTime.Date, TimeSpan.Zero).AddDays(-6);

        var live = db.Messages.AsNoTracking().Where(m => m.DeletedAt == null);

        var totals = new ModAnalyticsTotalsDto(
            await db.Rooms.CountAsync(ct),
            await db.Users.CountAsync(ct),
            await live.CountAsync(m => m.ParentId == null, ct),
            await live.CountAsync(m => m.ParentId != null, ct),
            await live.CountAsync(ct),
            await db.Votes.CountAsync(ct),
            await db.Reports.CountAsync(ct));

        var last24 = new ModAnalyticsWindowDto(
            await db.Users.CountAsync(u => u.CreatedAt >= since24, ct),
            await live.CountAsync(m => m.ParentId == null && m.CreatedAt >= since24, ct),
            await live.CountAsync(m => m.ParentId != null && m.CreatedAt >= since24, ct),
            await live.CountAsync(m => m.CreatedAt >= since24, ct),
            await db.Votes.CountAsync(v => v.CreatedAt >= since24, ct),
            await db.Reports.CountAsync(r => r.CreatedAt >= since24, ct));

        var reportStats = new ModReportAnalyticsDto(
            await db.Reports.CountAsync(r => r.Status == ReportStatus.Open, ct),
            await db.Reports.CountAsync(r => r.Status == ReportStatus.Resolved, ct),
            await db.Reports.CountAsync(r => r.Status == ReportStatus.Dismissed, ct));

        var userStats = new ModUserAnalyticsDto(
            await db.Users.CountAsync(u => u.BannedAt != null, ct),
            await CountRoleMembersAsync(Roles.Moderator, ct),
            await CountRoleMembersAsync(Roles.Admin, ct));

        return Ok(new ModAnalyticsDto(
            totals,
            last24,
            reportStats,
            userStats,
            await LoadTrendAsync(since7, ct),
            await LoadTopRoomsAsync(ct),
            await LoadTopPostsAsync(now, ct)));
    }

    private Task<int> CountRoleMembersAsync(string role, CancellationToken ct)
    {
        var normalized = role.ToUpperInvariant();
        return db.UserRoles.AsNoTracking()
            .Join(db.Roles, ur => ur.RoleId, r => r.Id, (ur, r) => r.NormalizedName)
            .CountAsync(name => name == normalized, ct);
    }

    private async Task<IReadOnlyList<ModTrendPointDto>> LoadTrendAsync(DateTimeOffset since7, CancellationToken ct)
    {
        // Only timestamps in the 7-day window cross the wire, not whole tables.
        var userDays = await db.Users.AsNoTracking()
            .Where(u => u.CreatedAt >= since7).Select(u => u.CreatedAt).ToListAsync(ct);
        var messageDays = await db.Messages.AsNoTracking()
            .Where(m => m.DeletedAt == null && m.CreatedAt >= since7).Select(m => m.CreatedAt).ToListAsync(ct);
        var voteDays = await db.Votes.AsNoTracking()
            .Where(v => v.CreatedAt >= since7).Select(v => v.CreatedAt).ToListAsync(ct);
        var reportDays = await db.Reports.AsNoTracking()
            .Where(r => r.CreatedAt >= since7).Select(r => r.CreatedAt).ToListAsync(ct);

        return Enumerable.Range(0, 7)
            .Select(offset => since7.AddDays(offset))
            .Select(day =>
            {
                var next = day.AddDays(1);
                return new ModTrendPointDto(
                    day.ToString("MM-dd"),
                    userDays.Count(t => t >= day && t < next),
                    messageDays.Count(t => t >= day && t < next),
                    voteDays.Count(t => t >= day && t < next),
                    reportDays.Count(t => t >= day && t < next));
            })
            .ToList();
    }

    private async Task<IReadOnlyList<ModRoomAnalyticsDto>> LoadTopRoomsAsync(CancellationToken ct)
    {
        var rooms = await db.Rooms.AsNoTracking().ToListAsync(ct);
        var live = db.Messages.AsNoTracking().Where(m => m.DeletedAt == null);

        var threads = await live.Where(m => m.ParentId == null)
            .GroupBy(m => m.RoomId).Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        var replies = await live.Where(m => m.ParentId != null)
            .GroupBy(m => m.RoomId).Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        var votes = await db.Votes.AsNoTracking().Where(v => v.Message.DeletedAt == null)
            .GroupBy(v => v.Message.RoomId).Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        var reports = await db.Reports.AsNoTracking()
            .GroupBy(r => r.Message.RoomId).Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        var latest = await live
            .GroupBy(m => m.RoomId).Select(g => new { g.Key, LatestAt = g.Max(m => m.CreatedAt) })
            .ToDictionaryAsync(x => x.Key, x => (DateTimeOffset?)x.LatestAt, ct);

        return rooms
            .Select(room => new ModRoomAnalyticsDto(
                room.Id,
                room.Name,
                room.Slug,
                threads.GetValueOrDefault(room.Id),
                replies.GetValueOrDefault(room.Id),
                votes.GetValueOrDefault(room.Id),
                reports.GetValueOrDefault(room.Id),
                latest.GetValueOrDefault(room.Id)))
            .OrderByDescending(r => r.Threads + r.Replies + r.Votes + r.Reports)
            .ThenByDescending(r => r.LatestActivityAt)
            .Take(8)
            .ToList();
    }

    private async Task<IReadOnlyList<ModPostAnalyticsDto>> LoadTopPostsAsync(DateTimeOffset now, CancellationToken ct)
    {
        // Reuses the cached highlights snapshot instead of re-walking every thread.
        var snapshot = await highlights.GetSnapshotAsync(ct);
        var top = snapshot.Candidates
            .OrderByDescending(m => HighlightsService.Score(snapshot.Stats[m.Id], now))
            .ThenByDescending(m => snapshot.Stats[m.Id].ActivityAt)
            .Take(10)
            .ToList();
        if (top.Count == 0) return [];

        var authorIds = top.Select(m => m.AuthorId).Distinct().ToArray();
        var authorNames = await db.Users.AsNoTracking()
            .Where(u => authorIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => $"@{u.UserName ?? u.DisplayName ?? "anon"}", ct);
        var roomIds = top.Select(m => m.RoomId).Distinct().ToArray();
        var roomNames = await db.Rooms.AsNoTracking()
            .Where(r => roomIds.Contains(r.Id))
            .ToDictionaryAsync(r => r.Id, r => r.Name, ct);

        return top.Select(m =>
        {
            var stat = snapshot.Stats[m.Id];
            return new ModPostAnalyticsDto(
                m.Id,
                m.Body.Length > 110 ? $"{m.Body[..110]}..." : m.Body,
                roomNames.GetValueOrDefault(m.RoomId, "#unknown"),
                authorNames.GetValueOrDefault(m.AuthorId, "@anon"),
                m.Depth,
                stat.Upvotes,
                stat.DirectReplies,
                m.CreatedAt);
        }).ToList();
    }

    [HttpGet("reports")]
    public async Task<ActionResult<IReadOnlyList<ModReportDto>>> Reports([FromQuery] string status = "open", CancellationToken ct = default)
    {
        if (!TryParseStatus(status, out var parsed)) return BadRequest(new { error = "INVALID_STATUS" });

        var reports = await db.Reports
            .AsNoTracking()
            .Where(r => r.Status == parsed)
            .OrderBy(r => r.CreatedAt)
            .Select(r => new ModReportDto(
                r.Id,
                r.MessageId,
                r.ReporterId,
                r.Reason.ToString().ToLowerInvariant(),
                r.Note,
                r.Status.ToString().ToLowerInvariant(),
                r.Message.Body,
                r.Message.AuthorId))
            .ToListAsync(ct);

        return Ok(reports);
    }

    [HttpPost("reports/{id:guid}/resolve")]
    public Task<IActionResult> Resolve(Guid id, CancellationToken ct) =>
        SetReportStatus(id, ReportStatus.Resolved, ct);

    [HttpPost("reports/{id:guid}/dismiss")]
    public Task<IActionResult> Dismiss(Guid id, CancellationToken ct) =>
        SetReportStatus(id, ReportStatus.Dismissed, ct);

    [HttpPost("users/{id:guid}/ban")]
    public async Task<IActionResult> Ban(Guid id, CancellationToken ct)
    {
        var user = await userManager.FindByIdAsync(id.ToString());
        if (user is null) return NotFound();

        user.BannedAt ??= DateTimeOffset.UtcNow;
        var result = await userManager.UpdateAsync(user);
        if (!result.Succeeded) return BadRequest(new { errors = result.Errors.Select(e => e.Description).ToArray() });

        // A ban ends the user's sessions: without this their refresh tokens stay valid for 30 days.
        await db.RefreshTokens
            .Where(t => t.UserId == user.Id && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, DateTimeOffset.UtcNow), ct);
        return NoContent();
    }

    [HttpPost("users/{id:guid}/unban")]
    public async Task<IActionResult> Unban(Guid id)
    {
        var user = await userManager.FindByIdAsync(id.ToString());
        if (user is null) return NotFound();

        user.BannedAt = null;
        var result = await userManager.UpdateAsync(user);
        return result.Succeeded ? NoContent() : BadRequest(new { errors = result.Errors.Select(e => e.Description).ToArray() });
    }

    [Authorize(Roles = Roles.Admin)]
    [HttpPost("users/{id:guid}/roles")]
    public async Task<IActionResult> UpdateRole(Guid id, UpdateRoleRequest request)
    {
        if (!string.Equals(request.Role, Roles.Moderator, StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { error = "ONLY_MODERATOR_ROLE_CAN_BE_CHANGED" });

        var user = await userManager.FindByIdAsync(id.ToString());
        if (user is null) return NotFound();

        var result = request.Grant
            ? await userManager.AddToRoleAsync(user, Roles.Moderator)
            : await userManager.RemoveFromRoleAsync(user, Roles.Moderator);

        return result.Succeeded ? NoContent() : BadRequest(new { errors = result.Errors.Select(e => e.Description).ToArray() });
    }

    [HttpGet("users")]
    public async Task<ActionResult<IReadOnlyList<ModUserDto>>> Users([FromQuery] string? query = null, CancellationToken ct = default)
    {
        query = query?.Trim().ToLowerInvariant();
        var usersQuery = db.Users.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(query))
        {
            usersQuery = usersQuery.Where(u =>
                (u.Email != null && u.Email.ToLower().Contains(query)) ||
                (u.UserName != null && u.UserName.ToLower().Contains(query)) ||
                (u.DisplayName != null && u.DisplayName.ToLower().Contains(query)));
        }

        var users = await usersQuery.OrderBy(u => u.Email).Take(25).ToListAsync(ct);
        var result = new List<ModUserDto>();
        foreach (var user in users)
        {
            var roles = await userManager.GetRolesAsync(user);
            result.Add(new ModUserDto(
                user.Id,
                user.Email,
                user.UserName,
                user.DisplayName,
                user.IsBanned,
                roles.Order(StringComparer.Ordinal).ToArray()));
        }

        return Ok(result);
    }

    private async Task<IActionResult> SetReportStatus(Guid id, ReportStatus status, CancellationToken ct)
    {
        var report = await db.Reports.SingleOrDefaultAsync(r => r.Id == id, ct);
        if (report is null) return NotFound();

        report.Status = status;
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    private static bool TryParseStatus(string status, out ReportStatus parsed)
    {
        parsed = status.ToLowerInvariant() switch
        {
            "open" => ReportStatus.Open,
            "resolved" => ReportStatus.Resolved,
            "dismissed" => ReportStatus.Dismissed,
            _ => default
        };
        return status.ToLowerInvariant() is "open" or "resolved" or "dismissed";
    }
}
