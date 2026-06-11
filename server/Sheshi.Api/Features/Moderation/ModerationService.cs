using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;
using Sheshi.Api.Features.Messages;

namespace Sheshi.Api.Features.Moderation;

/// <summary>
/// Data side of the moderation feature: analytics aggregation, report/user
/// listings, and the privileged mutations (ban, role, report status). The
/// controller stays thin — auth, audit logging, and HTTP mapping only.
/// </summary>
public class ModerationService(
    AppDbContext db,
    UserManager<ApplicationUser> userManager,
    HighlightsService highlights,
    IMemoryCache cache)
{
    private const string AnalyticsCacheKey = "mod:analytics:v1";
    private static readonly TimeSpan AnalyticsTtl = TimeSpan.FromSeconds(45);

    // The dashboard polls this frequently; a short TTL collapses the ~dozen
    // aggregate queries to one build per window. Slight staleness is fine here.
    public async Task<ModAnalyticsDto> BuildAnalyticsAsync(CancellationToken ct = default)
    {
        if (cache.TryGetValue(AnalyticsCacheKey, out ModAnalyticsDto? cached) && cached is not null)
            return cached;

        var analytics = await ComputeAnalyticsAsync(ct);
        cache.Set(AnalyticsCacheKey, analytics, AnalyticsTtl);
        return analytics;
    }

    private async Task<ModAnalyticsDto> ComputeAnalyticsAsync(CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var since24 = now.AddHours(-24);
        var since7 = new DateTimeOffset(now.UtcDateTime.Date, TimeSpan.Zero).AddDays(-6);
        var weekAgo = now.AddDays(-7);
        var twoWeeksAgo = now.AddDays(-14);
        var monthAgo = now.AddDays(-30);

        // One pass per table with conditional aggregation (COUNT(*) FILTER(...))
        // instead of a dozen separate COUNT round-trips.
        var msg = await db.Messages.AsNoTracking().Where(m => m.DeletedAt == null)
            .GroupBy(_ => 1)
            .Select(g => new
            {
                Threads = g.Count(m => m.ParentId == null),
                Replies = g.Count(m => m.ParentId != null),
                Total = g.Count(),
                Threads24 = g.Count(m => m.ParentId == null && m.CreatedAt >= since24),
                Replies24 = g.Count(m => m.ParentId != null && m.CreatedAt >= since24),
                Total24 = g.Count(m => m.CreatedAt >= since24),
                MsgCurrent = g.Count(m => m.CreatedAt >= weekAgo),
                MsgPrevious = g.Count(m => m.CreatedAt >= twoWeeksAgo && m.CreatedAt < weekAgo),
                AnsweredThreads = g.Count(m => m.ParentId == null && m.ReplyCount > 0),
                ReplySum = g.Sum(m => m.ParentId == null ? m.ReplyCount : 0)
            })
            .FirstOrDefaultAsync(ct);

        var deletionStats = await db.Messages.AsNoTracking()
            .GroupBy(_ => 1)
            .Select(g => new { All = g.Count(), Deleted = g.Count(m => m.DeletedAt != null) })
            .FirstOrDefaultAsync(ct);

        var voteStats = await db.Votes.AsNoTracking()
            .GroupBy(_ => 1)
            .Select(g => new
            {
                Total = g.Count(),
                Last24 = g.Count(v => v.CreatedAt >= since24),
                Current = g.Count(v => v.CreatedAt >= weekAgo),
                Previous = g.Count(v => v.CreatedAt >= twoWeeksAgo && v.CreatedAt < weekAgo)
            })
            .FirstOrDefaultAsync(ct);

        var reportRollup = await db.Reports.AsNoTracking()
            .GroupBy(_ => 1)
            .Select(g => new
            {
                Total = g.Count(),
                Last24 = g.Count(r => r.CreatedAt >= since24),
                Open = g.Count(r => r.Status == ReportStatus.Open),
                Resolved = g.Count(r => r.Status == ReportStatus.Resolved),
                Dismissed = g.Count(r => r.Status == ReportStatus.Dismissed)
            })
            .FirstOrDefaultAsync(ct);

        var userRollup = await db.Users.AsNoTracking()
            .GroupBy(_ => 1)
            .Select(g => new
            {
                Total = g.Count(),
                New24 = g.Count(u => u.CreatedAt >= since24),
                Banned = g.Count(u => u.BannedAt != null),
                Current = g.Count(u => u.CreatedAt >= weekAgo),
                Previous = g.Count(u => u.CreatedAt >= twoWeeksAgo && u.CreatedAt < weekAgo)
            })
            .FirstOrDefaultAsync(ct);

        var totals = new ModAnalyticsTotalsDto(
            await db.Rooms.CountAsync(ct),
            userRollup?.Total ?? 0,
            msg?.Threads ?? 0,
            msg?.Replies ?? 0,
            msg?.Total ?? 0,
            voteStats?.Total ?? 0,
            reportRollup?.Total ?? 0);

        var last24 = new ModAnalyticsWindowDto(
            userRollup?.New24 ?? 0,
            msg?.Threads24 ?? 0,
            msg?.Replies24 ?? 0,
            msg?.Total24 ?? 0,
            voteStats?.Last24 ?? 0,
            reportRollup?.Last24 ?? 0);

        var reportStats = new ModReportAnalyticsDto(
            reportRollup?.Open ?? 0,
            reportRollup?.Resolved ?? 0,
            reportRollup?.Dismissed ?? 0);

        var userStats = new ModUserAnalyticsDto(
            userRollup?.Banned ?? 0,
            await CountRoleMembersAsync(Roles.Moderator, ct),
            await CountRoleMembersAsync(Roles.Admin, ct));

        var growth = new ModGrowthDto(
            new ModGrowthPointDto(userRollup?.Current ?? 0, userRollup?.Previous ?? 0),
            new ModGrowthPointDto(msg?.MsgCurrent ?? 0, msg?.MsgPrevious ?? 0),
            new ModGrowthPointDto(voteStats?.Current ?? 0, voteStats?.Previous ?? 0));

        var totalThreads = msg?.Threads ?? 0;
        var engagement = new ModEngagementDto(
            totalThreads == 0 ? 0 : Math.Round((msg!.AnsweredThreads * 100.0) / totalThreads, 1),
            totalThreads == 0 ? 0 : Math.Round((double)(msg!.ReplySum) / totalThreads, 2));

        return new ModAnalyticsDto(
            totals,
            last24,
            reportStats,
            userStats,
            await LoadActiveUsersAsync(since24, weekAgo, monthAgo, ct),
            growth,
            engagement,
            await LoadModerationHealthAsync(now, monthAgo, deletionStats?.All ?? 0, deletionStats?.Deleted ?? 0, reportRollup?.Total ?? 0, ct),
            await LoadTrendAsync(since7, ct),
            await LoadTopRoomsAsync(ct),
            await LoadTopPostsAsync(now, ct),
            await LoadTopAuthorsAsync(ct));
    }

    private async Task<ModActiveUsersDto> LoadActiveUsersAsync(
        DateTimeOffset since24, DateTimeOffset since7, DateTimeOffset since30, CancellationToken ct)
    {
        // Active = posted OR voted in the window (no last-seen column needed).
        Task<int> ActiveAsync(DateTimeOffset since) =>
            db.Messages.AsNoTracking().Where(m => m.CreatedAt >= since).Select(m => m.AuthorId)
                .Union(db.Votes.AsNoTracking().Where(v => v.CreatedAt >= since).Select(v => v.UserId))
                .CountAsync(ct);

        return new ModActiveUsersDto(await ActiveAsync(since24), await ActiveAsync(since7), await ActiveAsync(since30));
    }

    private async Task<ModModerationHealthDto> LoadModerationHealthAsync(
        DateTimeOffset now, DateTimeOffset since30, int allMessages, int deletedMessages, int totalReports, CancellationToken ct)
    {
        // Resolution time over recently-closed reports (bounded window); interval
        // math is done in memory since SQL AVG of a duration isn't portable.
        var resolved = await db.Reports.AsNoTracking()
            .Where(r => r.ResolvedAt != null && r.ResolvedAt >= since30)
            .Select(r => new { r.CreatedAt, r.ResolvedAt })
            .ToListAsync(ct);
        double? avgResolution = resolved.Count == 0
            ? null
            : Math.Round(resolved.Average(r => (r.ResolvedAt!.Value - r.CreatedAt).TotalHours), 1);

        var openCreated = await db.Reports.AsNoTracking()
            .Where(r => r.Status == ReportStatus.Open)
            .Select(r => r.CreatedAt)
            .ToListAsync(ct);
        double? backlogAge = openCreated.Count == 0
            ? null
            : Math.Round(openCreated.Average(c => (now - c).TotalHours), 1);

        return new ModModerationHealthDto(
            avgResolution,
            backlogAge,
            allMessages == 0 ? 0 : Math.Round((totalReports * 1000.0) / allMessages, 2),
            allMessages == 0 ? 0 : Math.Round((deletedMessages * 100.0) / allMessages, 2));
    }

    private async Task<IReadOnlyList<ModAuthorAnalyticsDto>> LoadTopAuthorsAsync(CancellationToken ct)
    {
        var top = await db.Messages.AsNoTracking()
            .Where(m => m.DeletedAt == null)
            .GroupBy(m => m.AuthorId)
            .Select(g => new { AuthorId = g.Key, Count = g.Count() })
            .OrderByDescending(x => x.Count)
            .Take(8)
            .ToListAsync(ct);
        if (top.Count == 0) return [];

        var ids = top.Select(x => x.AuthorId).ToArray();
        var names = await db.Users.AsNoTracking()
            .Where(u => ids.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => $"@{u.UserName ?? u.DisplayName ?? "anon"}", ct);

        return top
            .Select(x => new ModAuthorAnalyticsDto(x.AuthorId, names.GetValueOrDefault(x.AuthorId, "@anon"), x.Count))
            .ToList();
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
        // Stamp resolution time once, when the report first leaves Open.
        report.ResolvedAt = status == ReportStatus.Open ? null : report.ResolvedAt ?? DateTimeOffset.UtcNow;
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
        // Bucket by UTC day in SQL so each table returns at most 7 rows, not every
        // row in the window.
        var users = await CountByDayAsync(db.Users.AsNoTracking()
            .Where(u => u.CreatedAt >= since7).Select(u => u.CreatedAt), ct);
        var messages = await CountByDayAsync(db.Messages.AsNoTracking()
            .Where(m => m.DeletedAt == null && m.CreatedAt >= since7).Select(m => m.CreatedAt), ct);
        var votes = await CountByDayAsync(db.Votes.AsNoTracking()
            .Where(v => v.CreatedAt >= since7).Select(v => v.CreatedAt), ct);
        var reports = await CountByDayAsync(db.Reports.AsNoTracking()
            .Where(r => r.CreatedAt >= since7).Select(r => r.CreatedAt), ct);

        return Enumerable.Range(0, 7)
            .Select(offset => since7.AddDays(offset).UtcDateTime.Date)
            .Select(day => new ModTrendPointDto(
                day.ToString("MM-dd"),
                users.GetValueOrDefault(day),
                messages.GetValueOrDefault(day),
                votes.GetValueOrDefault(day),
                reports.GetValueOrDefault(day)))
            .ToList();
    }

    private static async Task<Dictionary<DateTime, int>> CountByDayAsync(IQueryable<DateTimeOffset> times, CancellationToken ct)
    {
        var rows = await times
            .GroupBy(t => new { t.UtcDateTime.Year, t.UtcDateTime.Month, t.UtcDateTime.Day })
            .Select(g => new { g.Key.Year, g.Key.Month, g.Key.Day, Count = g.Count() })
            .ToListAsync(ct);
        return rows.ToDictionary(r => new DateTime(r.Year, r.Month, r.Day), r => r.Count);
    }

    private async Task<IReadOnlyList<ModRoomAnalyticsDto>> LoadTopRoomsAsync(CancellationToken ct)
    {
        // ThreadCount and LatestActivityAt are denormalized on Room; only replies,
        // votes, and reports still need aggregation.
        var rooms = await db.Rooms.AsNoTracking().ToListAsync(ct);
        var live = db.Messages.AsNoTracking().Where(m => m.DeletedAt == null);

        var replies = await live.Where(m => m.ParentId != null)
            .GroupBy(m => m.RoomId).Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        var votes = await db.Votes.AsNoTracking().Where(v => v.Message.DeletedAt == null)
            .GroupBy(v => v.Message.RoomId).Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        var reports = await db.Reports.AsNoTracking()
            .GroupBy(r => r.Message.RoomId).Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count, ct);

        return rooms
            .Select(room => new ModRoomAnalyticsDto(
                room.Id,
                room.Name,
                room.Slug,
                room.ThreadCount,
                replies.GetValueOrDefault(room.Id),
                votes.GetValueOrDefault(room.Id),
                reports.GetValueOrDefault(room.Id),
                room.LatestActivityAt))
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
            .OrderByDescending(m => highlights.Score(snapshot.Stats[m.Id], now))
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
