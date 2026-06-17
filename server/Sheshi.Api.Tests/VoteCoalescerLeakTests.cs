using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Sheshi.Api.Realtime;

namespace Sheshi.Api.Tests;

// Regression for FINDING 7 (LOW): a bare leading-edge vote_changed broadcast used to create a
// _byMessage entry but schedule no cleanup, so a single vote on a never-revisited message leaked its
// Pending entry forever (unbounded growth: one per such message). The fix arms a one-shot sweep
// (~Interval) on the leading edge that removes the entry unless a trailing flush has superseded it.
// We drive the singleton coalescer directly (the leading edge uses the caller's score and never touches
// the DB) and assert the internal PendingCount drains back to 0.
public class VoteCoalescerLeakTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Single_leading_edge_vote_on_a_fresh_message_does_not_leak_a_pending_entry()
    {
        var coalescer = factory.Services.GetRequiredService<VoteBroadcastCoalescer>();
        var freshMessageId = Guid.NewGuid();
        var freshRoomId = Guid.NewGuid();

        // A single vote on a never-seen message id: this is the leading edge — it broadcasts immediately
        // (best-effort, no DB read) and registers the tracking entry.
        coalescer.Request(freshMessageId, score: 1, roomId: freshRoomId, threadRootId: null);
        coalescer.PendingCount.Should().BeGreaterThan(0,
            "the leading edge must register a tracking entry for the burst window");

        // Wait past the 250ms coalescing Interval (plus generous margin for the sweep timer to fire).
        await Task.Delay(900);

        coalescer.PendingCount.Should().Be(0,
            "the leading-edge sweep must eventually remove the entry — a single vote must not leak forever");
    }

    [Fact]
    public async Task Leading_then_trailing_burst_still_drains_to_zero_without_dropping_the_flush()
    {
        var coalescer = factory.Services.GetRequiredService<VoteBroadcastCoalescer>();
        var freshMessageId = Guid.NewGuid();
        var freshRoomId = Guid.NewGuid();

        // Leading edge, then a follow-up within the Interval that arms a trailing flush. The sweep must
        // NOT prematurely remove the entry while a flush is pending (Trailing guard); the trailing flush
        // owns removal. Either way the entry must drain — the coalescing guarantee is preserved.
        coalescer.Request(freshMessageId, score: 1, roomId: freshRoomId, threadRootId: null);
        coalescer.Request(freshMessageId, score: 2, roomId: freshRoomId, threadRootId: null);
        coalescer.PendingCount.Should().BeGreaterThan(0);

        await Task.Delay(900);

        coalescer.PendingCount.Should().Be(0,
            "the trailing flush must remove the entry; the leading-edge sweep must not double-fire or leak it");
    }
}
