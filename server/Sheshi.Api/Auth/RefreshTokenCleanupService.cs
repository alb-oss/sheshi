using Microsoft.EntityFrameworkCore;
using Sheshi.Api.Data;

namespace Sheshi.Api.Auth;

/// <summary>
/// Periodically removes refresh tokens that are expired or were revoked more than 30 days ago,
/// so the table does not grow unbounded. A transient database error logs a warning and is retried
/// on the next interval rather than terminating the host.
/// </summary>
public sealed class RefreshTokenCleanupService(
    IServiceScopeFactory scopeFactory,
    ILogger<RefreshTokenCleanupService> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromHours(6);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Run one pass immediately on startup, then on the recurring timer.
        await CleanupAsync(stoppingToken);

        using var timer = new PeriodicTimer(Interval);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await CleanupAsync(stoppingToken);
        }
    }

    private async Task CleanupAsync(CancellationToken stoppingToken)
    {
        try
        {
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var now = DateTimeOffset.UtcNow;

            var removed = await db.RefreshTokens
                .Where(t => t.ExpiresAt < now || (t.RevokedAt != null && t.RevokedAt < now.AddDays(-30)))
                .ExecuteDeleteAsync(stoppingToken);

            if (removed > 0)
                logger.LogInformation("Refresh token cleanup removed {Count} stale token(s).", removed);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutdown in progress; let the loop exit normally.
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Refresh token cleanup pass failed; will retry on next interval.");
        }
    }
}
