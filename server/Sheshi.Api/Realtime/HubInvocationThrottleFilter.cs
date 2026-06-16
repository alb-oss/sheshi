using System.Collections.Concurrent;
using Microsoft.AspNetCore.SignalR;

namespace Sheshi.Api.Realtime;

// Per-connection abuse guard for hub invocations. UseRateLimiter only covers HTTP endpoints, not
// SignalR method calls. The hub is intentionally connectable ANONYMOUSLY so logged-out readers still
// get live updates — so instead of requiring auth we bound the blast radius of a single socket:
//   • a cap on concurrent group memberships (rooms + threads), so JoinRoom can't be looped over
//     thousands of room ids to amplify every broadcast back to that connection, and
//   • a fixed-window cap on Join* invocations, so the connection can't flood Join/presence traffic.
// State is per connection and removed on disconnect. The per-bucket lock only guards the synchronous
// pre-check and post-invoke mutations — never held across the awaited next() call.
public sealed class HubInvocationThrottleFilter : IHubFilter
{
    private const int MaxGroupsPerConnection = 10; // ~5 rooms + 5 threads per tab, with headroom
    private const int MaxJoinsPerWindow = 20;
    private static readonly TimeSpan WindowDuration = TimeSpan.FromSeconds(60);

    private readonly ConcurrentDictionary<string, ConnectionBucket> _buckets = new();

    public async ValueTask<object?> InvokeMethodAsync(
        HubInvocationContext invocationContext,
        Func<HubInvocationContext, ValueTask<object?>> next)
    {
        var method = invocationContext.HubMethodName;
        var isJoin = method is "JoinRoom" or "JoinThread" or "JoinModeration";
        var isLeave = method is "LeaveRoom" or "LeaveThread";
        if (!isJoin && !isLeave)
            return await next(invocationContext);

        var bucket = _buckets.GetOrAdd(invocationContext.Context.ConnectionId, _ => new ConnectionBucket());

        if (isJoin)
        {
            var occupiesSlot = method is "JoinRoom" or "JoinThread";
            var groupKey = GroupKey(method, invocationContext);
            lock (bucket.Gate)
            {
                var now = DateTimeOffset.UtcNow;
                if (now - bucket.WindowStart >= WindowDuration)
                {
                    bucket.WindowStart = now;
                    bucket.InvocationCount = 0;
                }
                if (bucket.InvocationCount >= MaxJoinsPerWindow)
                    throw new HubException("RATE_LIMITED");
                if (occupiesSlot && !bucket.ActiveGroups.Contains(groupKey) &&
                    bucket.ActiveGroups.Count >= MaxGroupsPerConnection)
                    throw new HubException("RATE_LIMITED");
            }

            var result = await next(invocationContext);

            lock (bucket.Gate)
            {
                bucket.InvocationCount++;
                if (occupiesSlot)
                    bucket.ActiveGroups.Add(groupKey);
            }
            return result;
        }

        // Leave*: run, then free the slot taken by the matching Join.
        var leaveResult = await next(invocationContext);
        lock (bucket.Gate)
            bucket.ActiveGroups.Remove(MatchingJoinKey(method, invocationContext));
        return leaveResult;
    }

    public async Task OnDisconnectedAsync(
        HubLifetimeContext context,
        Exception? exception,
        Func<HubLifetimeContext, Exception?, Task> next)
    {
        _buckets.TryRemove(context.Context.ConnectionId, out _);
        await next(context, exception);
    }

    private static string GroupKey(string method, HubInvocationContext ctx) =>
        $"{method}:{(ctx.HubMethodArguments.Count > 0 ? ctx.HubMethodArguments[0] : null)}";

    private static string MatchingJoinKey(string leaveMethod, HubInvocationContext ctx)
    {
        var join = leaveMethod == "LeaveRoom" ? "JoinRoom" : "JoinThread";
        return $"{join}:{(ctx.HubMethodArguments.Count > 0 ? ctx.HubMethodArguments[0] : null)}";
    }

    private sealed class ConnectionBucket
    {
        public readonly object Gate = new();
        public readonly HashSet<string> ActiveGroups = [];
        public int InvocationCount;
        public DateTimeOffset WindowStart = DateTimeOffset.UtcNow;
    }
}
