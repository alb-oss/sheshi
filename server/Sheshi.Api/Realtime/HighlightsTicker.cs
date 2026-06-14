using Microsoft.AspNetCore.SignalR;

namespace Sheshi.Api.Realtime;

// Coalesces the global "highlights_changed" tick. Every write used to fan this out to ALL clients,
// and each client refetched the Hot/Top/Replied panel — so under load it was O(writes × clients) of
// broadcasts and refetches. This collapses a burst into at most one broadcast per Interval: the
// leading edge fires immediately, and a trailing timer guarantees the final state is still reflected.
// Singleton so the throttle is shared across requests (RealtimeNotifier is scoped).
public sealed class HighlightsTicker(IHubContext<ChatHub> hub) : IDisposable
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(3);
    private readonly object _gate = new();
    private DateTimeOffset _lastSent = DateTimeOffset.MinValue;
    private bool _pending;
    private Timer? _timer;

    public void Request()
    {
        lock (_gate)
        {
            var now = DateTimeOffset.UtcNow;
            var elapsed = now - _lastSent;
            if (elapsed >= Interval)
            {
                _lastSent = now;
                _ = SendAsync();
            }
            else if (!_pending)
            {
                _pending = true;
                _timer?.Dispose();
                _timer = new Timer(_ => Flush(), null, Interval - elapsed, Timeout.InfiniteTimeSpan);
            }
        }
    }

    private void Flush()
    {
        lock (_gate)
        {
            _pending = false;
            _lastSent = DateTimeOffset.UtcNow;
        }
        _ = SendAsync();
    }

    private async Task SendAsync()
    {
        try
        {
            await hub.Clients.All.SendAsync("highlights_changed");
        }
        catch
        {
            // best-effort tick; the panel also reloads on tab switch / navigation
        }
    }

    public void Dispose() => _timer?.Dispose();
}
