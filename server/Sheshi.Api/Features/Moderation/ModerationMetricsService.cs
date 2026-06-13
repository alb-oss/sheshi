using Microsoft.EntityFrameworkCore;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Features.Moderation;

public class ModerationMetricsService(AppDbContext db)
{
    public async Task<ModerationMetricsDto> GetAsync(CancellationToken ct = default)
    {
        var now = DateTimeOffset.UtcNow;
        var since = now.AddDays(-7);

        var openReports = await db.Reports.CountAsync(r => r.Status == ReportStatus.Open, ct);
        var openFlags = await db.ModerationFlags.CountAsync(f => f.Status == ModerationFlagStatus.Open, ct);

        var reportResolutionActions = await db.ModerationActions
            .AsNoTracking()
            .Where(a => a.ActionType == ModerationActionTypes.ReportResolved && a.CreatedAt >= since)
            .Select(a => new ReportResolutionAction(a.TargetId, a.CreatedAt))
            .ToListAsync(ct);

        var averageResolutionHours = await AverageReportResolutionHoursAsync(reportResolutionActions, ct);
        var oldestOpenItemHours = await OldestOpenItemHoursAsync(now, ct);

        var bans7d = await CountActionsAsync(ModerationActionTypes.UserBanned, since, ct);
        var deletedMessages7d = await CountActionsAsync(ModerationActionTypes.MessageDeleted, since, ct);

        var reportReasonRows = await db.Reports
            .AsNoTracking()
            .Where(r => r.Status == ReportStatus.Open)
            .GroupBy(r => r.Reason)
            .Select(g => new { Key = g.Key, Count = g.Count() })
            .ToListAsync(ct);
        var reportsByReason = reportReasonRows
            .Select(r => new MetricBucketDto(r.Key.ToString().ToLowerInvariant(), r.Count))
            .OrderByDescending(b => b.Count)
            .ThenBy(b => b.Key)
            .ToList();

        var flagRuleRows = await db.ModerationFlags
            .AsNoTracking()
            .Where(f => f.Status == ModerationFlagStatus.Open)
            .GroupBy(f => f.RuleKey)
            .Select(g => new { Key = g.Key, Count = g.Count() })
            .ToListAsync(ct);
        var flagsByRule = flagRuleRows
            .Select(r => new MetricBucketDto(r.Key, r.Count))
            .OrderByDescending(b => b.Count)
            .ThenBy(b => b.Key)
            .ToList();

        return new ModerationMetricsDto(
            openReports,
            openFlags,
            averageResolutionHours,
            oldestOpenItemHours,
            reportResolutionActions.Count,
            bans7d,
            deletedMessages7d,
            reportsByReason,
            flagsByRule);
    }

    private async Task<double?> AverageReportResolutionHoursAsync(
        IReadOnlyList<ReportResolutionAction> reportResolutionActions,
        CancellationToken ct)
    {
        if (reportResolutionActions.Count == 0) return null;

        var reportIds = reportResolutionActions.Select(a => a.TargetId).Distinct().ToArray();
        var reportCreatedAt = await db.Reports
            .AsNoTracking()
            .Where(r => reportIds.Contains(r.Id))
            .Select(r => new { r.Id, r.CreatedAt })
            .ToDictionaryAsync(r => r.Id, r => r.CreatedAt, ct);

        var durations = reportResolutionActions
            .Where(a => reportCreatedAt.ContainsKey(a.TargetId))
            .Select(a => (a.CreatedAt - reportCreatedAt[a.TargetId]).TotalHours)
            .Where(hours => hours >= 0)
            .ToArray();

        return durations.Length == 0 ? null : durations.Average();
    }

    private async Task<double?> OldestOpenItemHoursAsync(DateTimeOffset now, CancellationToken ct)
    {
        var oldestReport = await db.Reports
            .AsNoTracking()
            .Where(r => r.Status == ReportStatus.Open)
            .Select(r => (DateTimeOffset?)r.CreatedAt)
            .MinAsync(ct);

        var oldestFlag = await db.ModerationFlags
            .AsNoTracking()
            .Where(f => f.Status == ModerationFlagStatus.Open)
            .Select(f => (DateTimeOffset?)f.CreatedAt)
            .MinAsync(ct);

        var oldest = new[] { oldestReport, oldestFlag }
            .Where(value => value is not null)
            .Min();

        return oldest is null ? null : (now - oldest.Value).TotalHours;
    }

    private Task<int> CountActionsAsync(string actionType, DateTimeOffset since, CancellationToken ct) =>
        db.ModerationActions.CountAsync(a => a.ActionType == actionType && a.CreatedAt >= since, ct);

    private sealed record ReportResolutionAction(Guid TargetId, DateTimeOffset CreatedAt);
}
