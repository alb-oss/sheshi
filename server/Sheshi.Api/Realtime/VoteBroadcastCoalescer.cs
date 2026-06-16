using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Sheshi.Api.Data;
using Sheshi.Api.Features.Messages;

namespace Sheshi.Api.Realtime;

// Coalesces vote_changed broadcasts PER MESSAGE. A viral post can take many votes/sec; each one used to
// fan a separate broadcast out to every viewer (O(votes × viewers)). This collapses a burst into ~1
// broadcast per message per Interval — the leading edge fires immediately with the caller's freshly
// computed score, and a trailing timer guarantees the FINAL state is reflected by RE-READING the
// absolute score from the DB at flush time (so even out-of-order concurrent votes can't leave a stale
// number on the wire). vote_changed is idempotent (absolute SUM), so coalescing never loses truth.
// Singleton so the throttle is shared across requests (RealtimeNotifier is scoped); takes a scope
// factory because it must query the DB from a timer thread.
public sealed class VoteBroadcastCoalescer(
    IHubContext<ChatHub> hub,
    IServiceScopeFactory scopeFactory,
    HighlightsTicker highlightsTicker) : IDisposable
{
    private static readonly TimeSpan Interval = TimeSpan.FromMilliseconds(250);

    private sealed class Pending
    {
        public Guid RoomId;
        public Guid? RootId;
        public DateTimeOffset LastSent = DateTimeOffset.MinValue;
        public bool Trailing;
        public Timer? Timer;
    }

    private readonly object _gate = new();
    private readonly Dictionary<Guid, Pending> _byMessage = new();

    public void Request(Guid messageId, int score, Guid roomId, Guid? threadRootId)
    {
        // Votes also move the cross-room "Hot" ranking; keep ticking it (it self-coalesces).
        highlightsTicker.Request();

        lock (_gate)
        {
            if (!_byMessage.TryGetValue(messageId, out var p))
            {
                p = new Pending();
                _byMessage[messageId] = p;
            }
            p.RoomId = roomId;
            p.RootId = threadRootId;

            var now = DateTimeOffset.UtcNow;
            if (now - p.LastSent >= Interval)
            {
                p.LastSent = now;
                _ = SendAsync(messageId, score, roomId, threadRootId); // leading edge: caller's score
            }
            else if (!p.Trailing)
            {
                p.Trailing = true;
                p.Timer?.Dispose();
                p.Timer = new Timer(_ => Flush(messageId), null, Interval - (now - p.LastSent), Timeout.InfiniteTimeSpan);
            }
        }
    }

    private void Flush(Guid messageId)
    {
        Guid roomId;
        Guid? rootId;
        lock (_gate)
        {
            if (!_byMessage.TryGetValue(messageId, out var p)) return;
            roomId = p.RoomId;
            rootId = p.RootId;
            p.Timer?.Dispose();
            _byMessage.Remove(messageId); // entry lives only for the burst window — bounds memory
        }
        _ = FlushAsync(messageId, roomId, rootId);
    }

    private async Task FlushAsync(Guid messageId, Guid roomId, Guid? rootId)
    {
        try
        {
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            // Re-read the absolute score so the final broadcast reflects DB truth, not whatever the last
            // coalesced request happened to carry.
            var score = await db.Votes.Where(v => v.MessageId == messageId).SumAsync(v => (int)v.Value);
            await SendAsync(messageId, score, roomId, rootId);
        }
        catch
        {
            // best-effort; clients reconcile on reconnect / foreground
        }
    }

    private async Task SendAsync(Guid messageId, int score, Guid roomId, Guid? rootId)
    {
        try
        {
            var payload = new VoteChangedEvent(messageId, score, roomId, rootId);
            await hub.Clients.Group(GroupNames.Room(roomId)).SendAsync("vote_changed", payload);
            if (rootId is not null)
                await hub.Clients.Group(GroupNames.Thread(rootId.Value)).SendAsync("vote_changed", payload);
        }
        catch
        {
            // best-effort; clients reconcile on reconnect / foreground
        }
    }

    public void Dispose()
    {
        lock (_gate)
        {
            foreach (var p in _byMessage.Values) p.Timer?.Dispose();
            _byMessage.Clear();
        }
    }
}
