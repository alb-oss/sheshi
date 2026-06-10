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
    UserManager<ApplicationUser> userManager) : ControllerBase
{
    [HttpGet("analytics")]
    public async Task<ActionResult<ModAnalyticsDto>> Analytics(CancellationToken ct = default)
    {
        var now = DateTimeOffset.UtcNow;
        var since24 = now.AddHours(-24);
        var since7 = new DateTimeOffset(now.UtcDateTime.Date, TimeSpan.Zero).AddDays(-6);

        var rooms = await db.Rooms.AsNoTracking().ToListAsync(ct);
        var messages = await db.Messages.AsNoTracking().Where(m => m.DeletedAt == null).ToListAsync(ct);
        var votes = await db.Votes.AsNoTracking().ToListAsync(ct);
        var reports = await db.Reports.AsNoTracking()
            .Select(r => new { r.Id, r.Status, r.CreatedAt, r.MessageId, RoomId = r.Message.RoomId })
            .ToListAsync(ct);
        var users = await db.Users.AsNoTracking().ToListAsync(ct);

        var adminRoleId = await db.Roles.AsNoTracking()
            .Where(r => r.NormalizedName == Roles.Admin.ToUpperInvariant())
            .Select(r => r.Id)
            .SingleOrDefaultAsync(ct);
        var modRoleId = await db.Roles.AsNoTracking()
            .Where(r => r.NormalizedName == Roles.Moderator.ToUpperInvariant())
            .Select(r => r.Id)
            .SingleOrDefaultAsync(ct);
        var adminCount = adminRoleId == Guid.Empty
            ? 0
            : await db.UserRoles.AsNoTracking().CountAsync(r => r.RoleId == adminRoleId, ct);
        var moderatorCount = modRoleId == Guid.Empty
            ? 0
            : await db.UserRoles.AsNoTracking().CountAsync(r => r.RoleId == modRoleId, ct);

        var totals = new ModAnalyticsTotalsDto(
            rooms.Count,
            users.Count,
            messages.Count(m => m.ParentId is null),
            messages.Count(m => m.ParentId is not null),
            messages.Count,
            votes.Count,
            reports.Count);

        var last24 = new ModAnalyticsWindowDto(
            users.Count(u => u.CreatedAt >= since24),
            messages.Count(m => m.ParentId is null && m.CreatedAt >= since24),
            messages.Count(m => m.ParentId is not null && m.CreatedAt >= since24),
            messages.Count(m => m.CreatedAt >= since24),
            votes.Count(v => v.CreatedAt >= since24),
            reports.Count(r => r.CreatedAt >= since24));

        var reportStats = new ModReportAnalyticsDto(
            reports.Count(r => r.Status == ReportStatus.Open),
            reports.Count(r => r.Status == ReportStatus.Resolved),
            reports.Count(r => r.Status == ReportStatus.Dismissed));

        var trend = Enumerable.Range(0, 7)
            .Select(offset => since7.AddDays(offset))
            .Select(day =>
            {
                var next = day.AddDays(1);
                return new ModTrendPointDto(
                    day.ToString("MM-dd"),
                    users.Count(u => u.CreatedAt >= day && u.CreatedAt < next),
                    messages.Count(m => m.CreatedAt >= day && m.CreatedAt < next),
                    votes.Count(v => v.CreatedAt >= day && v.CreatedAt < next),
                    reports.Count(r => r.CreatedAt >= day && r.CreatedAt < next));
            })
            .ToList();

        var votesByMessage = votes.GroupBy(v => v.MessageId).ToDictionary(g => g.Key, g => g.Count());
        var repliesByMessage = messages
            .Where(m => m.ParentId is not null)
            .GroupBy(m => m.ParentId!.Value)
            .ToDictionary(g => g.Key, g => g.Count());
        var messagesById = messages.ToDictionary(m => m.Id);
        var descendantsByMessage = messages.ToDictionary(m => m.Id, _ => 0);
        var branchVotesByMessage = messages.ToDictionary(m => m.Id, _ => 0);
        var activityByMessage = messages.ToDictionary(m => m.Id, m => m.CreatedAt);
        foreach (var message in messages)
        {
            var parentId = message.ParentId;
            var seen = new HashSet<Guid>();
            var messageVotes = votesByMessage.GetValueOrDefault(message.Id);
            while (parentId is Guid id && seen.Add(id) && messagesById.TryGetValue(id, out var parent))
            {
                descendantsByMessage[id] += 1;
                branchVotesByMessage[id] += messageVotes;
                if (message.CreatedAt > activityByMessage[id]) activityByMessage[id] = message.CreatedAt;
                parentId = parent.ParentId;
            }
        }
        var votesByRoom = votes
            .Join(messages, v => v.MessageId, m => m.Id, (_, m) => m.RoomId)
            .GroupBy(id => id)
            .ToDictionary(g => g.Key, g => g.Count());
        var reportsByRoom = reports
            .GroupBy(r => r.RoomId)
            .ToDictionary(g => g.Key, g => g.Count());
        var latestByRoom = messages
            .GroupBy(m => m.RoomId)
            .ToDictionary(g => g.Key, g => (DateTimeOffset?)g.Max(m => m.CreatedAt));

        var topRooms = rooms
            .Select(room => new ModRoomAnalyticsDto(
                room.Id,
                room.Name,
                room.Slug,
                messages.Count(m => m.RoomId == room.Id && m.ParentId is null),
                messages.Count(m => m.RoomId == room.Id && m.ParentId is not null),
                votesByRoom.GetValueOrDefault(room.Id),
                reportsByRoom.GetValueOrDefault(room.Id),
                latestByRoom.GetValueOrDefault(room.Id)))
            .OrderByDescending(r => r.Threads + r.Replies + r.Votes + r.Reports)
            .ThenByDescending(r => r.LatestActivityAt)
            .Take(8)
            .ToList();

        var authorIds = messages.Select(m => m.AuthorId).Distinct().ToArray();
        var authorNames = await db.Users.AsNoTracking()
            .Where(u => authorIds.Contains(u.Id))
            .ToDictionaryAsync(
                u => u.Id,
                u => $"@{u.UserName ?? u.DisplayName ?? "anon"}",
                ct);
        var roomNames = rooms.ToDictionary(r => r.Id, r => r.Name);

        var topPosts = messages
            .OrderByDescending(m => HighlightsController.AnalyticsScore(
                votesByMessage.GetValueOrDefault(m.Id),
                branchVotesByMessage.GetValueOrDefault(m.Id),
                repliesByMessage.GetValueOrDefault(m.Id),
                descendantsByMessage.GetValueOrDefault(m.Id),
                m.ParentId is not null,
                m.CreatedAt,
                activityByMessage.GetValueOrDefault(m.Id, m.CreatedAt),
                now))
            .ThenByDescending(m => activityByMessage.GetValueOrDefault(m.Id, m.CreatedAt))
            .Take(10)
            .Select(m => new ModPostAnalyticsDto(
                m.Id,
                m.Body.Length > 110 ? $"{m.Body[..110]}..." : m.Body,
                roomNames.GetValueOrDefault(m.RoomId, "#unknown"),
                authorNames.GetValueOrDefault(m.AuthorId, "@anon"),
                m.Depth,
                votesByMessage.GetValueOrDefault(m.Id),
                repliesByMessage.GetValueOrDefault(m.Id),
                m.CreatedAt))
            .ToList();

        return Ok(new ModAnalyticsDto(
            totals,
            last24,
            reportStats,
            new ModUserAnalyticsDto(users.Count(u => u.IsBanned), moderatorCount, adminCount),
            trend,
            topRooms,
            topPosts));
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
