using Microsoft.AspNetCore.SignalR;
using Sheshi.Api.Features.Messages;

namespace Sheshi.Api.Realtime;

// Realtime delta push (fast-paced + super-realtime spec, 2026-06-13).
// Each write broadcasts a single TYPED event carrying the payload the client applies in place
// (no refetch). The old coarse "changed" signal was removed — no client consumed it, and emitting
// it doubled the per-write fan-out to every room member.
public class RealtimeNotifier(IHubContext<ChatHub> hub, HighlightsTicker highlightsTicker)
{
    public async Task MessageCreatedAsync(MessageDto message, Guid? threadRootId, CancellationToken ct = default)
        => await BroadcastAsync(message.RoomId, threadRootId, "message_created",
            new MessageCreatedEvent(message, threadRootId), ct);

    public async Task VoteChangedAsync(Guid messageId, Guid roomId, int score, Guid? threadRootId, CancellationToken ct = default)
        => await BroadcastAsync(roomId, threadRootId, "vote_changed",
            new VoteChangedEvent(messageId, score, roomId, threadRootId), ct);

    // The voter's OWN vote, pushed only to that user's connections (Clients.User → all of their
    // devices/tabs). The public vote_changed echo carries only the net score — it deliberately never
    // says WHO voted (vote privacy) — so the colour (driven by my_vote) can't sync across a user's
    // devices from it. This per-user side-channel does that without leaking the vote to anyone else.
    public async Task MyVoteChangedAsync(Guid userId, Guid messageId, int value, CancellationToken ct = default)
        => await hub.Clients.User(userId.ToString())
            .SendAsync("my_vote_changed", new MyVoteChangedEvent(messageId, value), ct);

    public async Task MessageDeletedAsync(Guid messageId, Guid roomId, Guid? threadRootId, CancellationToken ct = default)
        => await BroadcastAsync(roomId, threadRootId, "message_deleted",
            new MessageDeletedEvent(messageId, roomId, threadRootId), ct);

    // Coarse tick to the moderator channel — any report/flag/action change. The /moderim panels
    // debounce a refetch (the queue + metrics can't be cheaply delta-patched).
    public async Task ModerationChangedAsync(CancellationToken ct = default)
        => await hub.Clients.Group(GroupNames.Moderators()).SendAsync("mod_changed", ct);

    // A new public room — broadcast to everyone so all sidebars/grids pick it up live.
    public async Task RoomCreatedAsync(object room, CancellationToken ct = default)
        => await hub.Clients.All.SendAsync("room_created", room, ct);

    private async Task BroadcastAsync(Guid roomId, Guid? threadRootId, string evt, object payload, CancellationToken ct)
    {
        await hub.Clients.Group(GroupNames.Room(roomId)).SendAsync(evt, payload, ct);
        if (threadRootId is not null)
            await hub.Clients.Group(GroupNames.Thread(threadRootId.Value)).SendAsync(evt, payload, ct);
        // Global tick so the cross-room "Hot" panel (joined to no group) can refresh. Coalesced
        // server-side (≤1 broadcast / few seconds) so a write burst doesn't fan out to every client.
        highlightsTicker.Request();
    }
}

// Snake_case on the wire (SignalR is configured with the same JSON policy as REST), so the
// `message` field is byte-identical to the REST MessageDto the client already consumes.
public record MessageCreatedEvent(MessageDto Message, Guid? RootId);
public record VoteChangedEvent(Guid MessageId, int Score, Guid RoomId, Guid? RootId);
public record MyVoteChangedEvent(Guid MessageId, int Value);
public record MessageDeletedEvent(Guid Id, Guid RoomId, Guid? RootId);
