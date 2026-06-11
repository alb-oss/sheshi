using Microsoft.EntityFrameworkCore;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Features.Moderation;

/// <summary>
/// Finalizes completed UTC days into the <see cref="DailyStat"/> table so the
/// dashboard can read long history cheaply. Runs once at startup (backfilling
/// any missing finalized days, capped at 90) and then hourly. Today is never
/// written — it is still mutable and is computed live by the history endpoint.
/// </summary>
public class DailyStatsRollupService(IServiceScopeFactory scopeFactory, ILogger<DailyStatsRollupService> logger)
    : BackgroundService
{
    private const int BackfillDays = 90;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
        do
        {
            try
            {
                await RollupAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Daily stats rollup pass failed.");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task RollupAsync(CancellationToken ct)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var today = DateTime.UtcNow.Date;
        var floor = today.AddDays(-BackfillDays);
        var floorOffset = new DateTimeOffset(floor, TimeSpan.Zero);

        var have = (await db.DailyStats.AsNoTracking()
            .Where(d => d.Date >= floor)
            .Select(d => d.Date)
            .ToListAsync(ct)).ToHashSet();

        var users = await CountByDayAsync(db.Users.AsNoTracking()
            .Where(u => u.CreatedAt >= floorOffset).Select(u => u.CreatedAt), ct);
        var messages = await CountByDayAsync(db.Messages.AsNoTracking()
            .Where(m => m.DeletedAt == null && m.CreatedAt >= floorOffset).Select(m => m.CreatedAt), ct);
        var votes = await CountByDayAsync(db.Votes.AsNoTracking()
            .Where(v => v.CreatedAt >= floorOffset).Select(v => v.CreatedAt), ct);
        var reports = await CountByDayAsync(db.Reports.AsNoTracking()
            .Where(r => r.CreatedAt >= floorOffset).Select(r => r.CreatedAt), ct);

        var added = 0;
        for (var day = floor; day < today; day = day.AddDays(1))
        {
            if (have.Contains(day)) continue;
            db.DailyStats.Add(new DailyStat
            {
                Date = day,
                NewUsers = users.GetValueOrDefault(day),
                Messages = messages.GetValueOrDefault(day),
                Votes = votes.GetValueOrDefault(day),
                Reports = reports.GetValueOrDefault(day)
            });
            added++;
        }

        if (added > 0)
        {
            await db.SaveChangesAsync(ct);
            logger.LogInformation("Daily stats rollup wrote {Count} finalized day(s).", added);
        }
    }

    private static async Task<Dictionary<DateTime, int>> CountByDayAsync(IQueryable<DateTimeOffset> times, CancellationToken ct)
    {
        var rows = await times
            .GroupBy(t => new { t.UtcDateTime.Year, t.UtcDateTime.Month, t.UtcDateTime.Day })
            .Select(g => new { g.Key.Year, g.Key.Month, g.Key.Day, Count = g.Count() })
            .ToListAsync(ct);
        return rows.ToDictionary(r => new DateTime(r.Year, r.Month, r.Day), r => r.Count);
    }
}
