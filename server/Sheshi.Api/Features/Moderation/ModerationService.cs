using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;
using Sheshi.Api.Features.Messages;

namespace Sheshi.Api.Features.Moderation;

/// <summary>
/// Data side of the moderation feature: analytics aggregation, report/user
/// listings, and the privileged mutations (ban, role, report status). The
/// controller stays thin — auth, audit logging, and HTTP mapping only.
/// </summary>
public class ModerationService(AppDbContext db, UserManager<ApplicationUser> userManager, HighlightsService highlights)
{
    public async Task<ModAnalyticsDto> BuildAnalyticsAsync(CancellationToken ct = default)
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

        return new ModAnalyticsDto(
            totals,
            last24,
            reportStats,
            userStats,
            await LoadTrendAsync(since7, ct),
            await LoadTopRoomsAsync(ct),
            await LoadTopPostsAsync(now, ct));
    }

    public async Task<IReadOnlyList<ModReportDto>> ListReportsAsync(ReportStatus status, CancellationToken ct = default) =>
        await db.Reports
            .AsNoTracking()
            .Where(r => r.Status == status)
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

    public async Task<IReadOnlyList<ModUserDto>> ListUsersAsync(string? query, CancellationToken ct = default)
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

        return result;
    }

    public async Task<ModActionResult> SetBanAsync(Guid userId, bool banned, CancellationToken ct = default)
    {
        var user = await userManager.FindByIdAsync(userId.ToString());
        if (user is null) return ModActionResult.NotFound();

        user.BannedAt = banned ? user.BannedAt ?? DateTimeOffset.UtcNow : null;
        var result = await userManager.UpdateAsync(user);
        if (!result.Succeeded) return ModActionResult.Failed(result.Errors.Select(e => e.Description).ToArray());

        if (banned)
        {
            // A ban ends the user's sessions: without this their refresh tokens stay valid for 30 days.
            await db.RefreshTokens
                .Where(t => t.UserId == user.Id && t.RevokedAt == null)
                .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, DateTimeOffset.UtcNow), ct);
        }

        return ModActionResult.Ok();
    }

    public async Task<ModActionResult> SetModeratorAsync(Guid userId, bool grant)
    {
        var user = await userManager.FindByIdAsync(userId.ToString());
        if (user is null) return ModActionResult.NotFound();

        var result = grant
            ? await userManager.AddToRoleAsync(user, Roles.Moderator)
            : await userManager.RemoveFromRoleAsync(user, Roles.Moderator);

        return result.Succeeded
            ? ModActionResult.Ok()
            : ModActionResult.Failed(result.Errors.Select(e => e.Description).ToArray());
    }

    public async Task<bool> SetReportStatusAsync(Guid reportId, ReportStatus status, CancellationToken ct = default)
    {
        var report = await db.Reports.SingleOrDefaultAsync(r => r.Id == reportId, ct);
        if (report is null) return false;

        report.Status = status;
        await db.SaveChangesAsync(ct);
        return true;
    }

    public static bool TryParseStatus(string status, out ReportStatus parsed)
    {
        (parsed, var ok) = status.ToLowerInvariant() switch
        {
            "open" => (ReportStatus.Open, true),
            "resolved" => (ReportStatus.Resolved, true),
            "dismissed" => (ReportStatus.Dismissed, true),
            _ => (default, false)
        };
        return ok;
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
}

public sealed record ModActionResult(bool Found, IReadOnlyList<string> Errors)
{
    public bool Succeeded => Found && Errors.Count == 0;
    public static ModActionResult Ok() => new(true, []);
    public static ModActionResult NotFound() => new(false, []);
    public static ModActionResult Failed(IReadOnlyList<string> errors) => new(true, errors);
}
