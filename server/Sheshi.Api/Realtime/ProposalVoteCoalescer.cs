using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Sheshi.Api.Data;

namespace Sheshi.Api.Realtime;

// Burst-windowed throttle for proposal vote tallies — a direct clone of VoteBroadcastCoalescer keyed by
// proposal. A hot proposal would otherwise broadcast O(votes × viewers); instead a 250ms window sends the
// caller's leading-edge tally at once and a trailing flush re-reads DB truth so the final number is exact
// even under out-of-order concurrent votes. One shared proposals:feed group, so no room/thread fan-out.
public sealed class ProposalVoteCoalescer(
    IHubContext<ChatHub> hub,
    IServiceScopeFactory scopeFactory) : IDisposable
{
    private static readonly TimeSpan Interval = TimeSpan.FromMilliseconds(250);

    private sealed class Pending
    {
        public DateTimeOffset LastSent = DateTimeOffset.MinValue;
        public bool Trailing;
        public Timer? Timer;
    }

    private readonly object _gate = new();
    private readonly Dictionary<Guid, Pending> _byProposal = new();

    public void Request(Guid proposalId, int score, int pro, int kunder)
    {
        lock (_gate)
        {
            if (!_byProposal.TryGetValue(proposalId, out var p))
            {
                p = new Pending();
                _byProposal[proposalId] = p;
            }

            var now = DateTimeOffset.UtcNow;
            if (now - p.LastSent >= Interval)
            {
                p.LastSent = now;
                _ = SendAsync(proposalId, score, pro, kunder); // leading edge: caller's tally
                // A bare leading edge schedules no flush; arm a one-shot sweep ~Interval out that removes
                // the entry ONLY if no trailing flush superseded it — otherwise a never-revoted proposal
                // would leak one Pending forever.
                p.Timer?.Dispose();
                p.Timer = new Timer(_ => SweepLeadingEdge(proposalId), null, Interval, Timeout.InfiniteTimeSpan);
            }
            else if (!p.Trailing)
            {
                p.Trailing = true;
                p.Timer?.Dispose();
                p.Timer = new Timer(_ => Flush(proposalId), null, Interval - (now - p.LastSent), Timeout.InfiniteTimeSpan);
            }
        }
    }

    private void SweepLeadingEdge(Guid proposalId)
    {
        lock (_gate)
        {
            if (!_byProposal.TryGetValue(proposalId, out var p)) return;
            if (p.Trailing) return; // a follow-up vote took over; its Flush timer owns removal
            p.Timer?.Dispose();
            _byProposal.Remove(proposalId);
        }
    }

    private void Flush(Guid proposalId)
    {
        lock (_gate)
        {
            if (!_byProposal.TryGetValue(proposalId, out var p)) return;
            p.Timer?.Dispose();
            _byProposal.Remove(proposalId); // entry lives only for the burst window — bounds memory
        }
        _ = FlushAsync(proposalId);
    }

    private async Task FlushAsync(Guid proposalId)
    {
        try
        {
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            // Re-read absolute tallies so the final broadcast reflects DB truth, not the last coalesced value.
            var pro = await db.ProposalVotes.CountAsync(v => v.ProposalId == proposalId && v.Value == 1);
            var kunder = await db.ProposalVotes.CountAsync(v => v.ProposalId == proposalId && v.Value == -1);
            await SendAsync(proposalId, pro - kunder, pro, kunder);
        }
        catch
        {
            // best-effort; clients reconcile on reconnect / foreground
        }
    }

    private async Task SendAsync(Guid proposalId, int score, int pro, int kunder)
    {
        try
        {
            var payload = new ProposalVoteChangedEvent(proposalId, score, pro, kunder);
            await hub.Clients.Group(GroupNames.Proposals()).SendAsync("proposal_vote_changed", payload);
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
            foreach (var p in _byProposal.Values) p.Timer?.Dispose();
            _byProposal.Clear();
        }
    }
}
