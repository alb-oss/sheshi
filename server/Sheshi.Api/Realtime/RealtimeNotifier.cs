using Microsoft.AspNetCore.SignalR;
using Sheshi.Api.Features.Messages;

namespace Sheshi.Api.Realtime;

// Realtime delta push (fast-paced + super-realtime spec, 2026-06-13).
// Each write broadcasts a TYPED event carrying the payload the client applies in place
// (no refetch). The legacy "changed" signal is still emitted alongside every event so any
// not-yet-upgraded consumer keeps working during the transition.
public class RealtimeNotifier(IHubContext<ChatHub> hub)
{
    public async Task MessageCreatedAsync(MessageDto message, Guid? threadRootId, CancellationToken ct = default)
        => await BroadcastAsync(message.RoomId, threadRootId, "message_created",
            new MessageCreatedEvent(message, threadRootId), ct);

    public async Task VoteChangedAsync(Guid messageId, Guid roomId, int upvotes, Guid? threadRootId, CancellationToken ct = default)
        => await BroadcastAsync(roomId, threadRootId, "vote_changed",
            new VoteChangedEvent(messageId, upvotes, roomId, threadRootId), ct);

    public async Task MessageDeletedAsync(Guid messageId, Guid roomId, Guid? threadRootId, CancellationToken ct = default)
        => await BroadcastAsync(roomId, threadRootId, "message_deleted",
            new MessageDeletedEvent(messageId, roomId, threadRootId), ct);

    // Legacy coarse signal — kept for backward compatibility (debounced-refetch clients).
    public async Task MessageChangedAsync(Guid roomId, Guid? threadId = null, CancellationToken ct = default)
    {
        await hub.Clients.Group(GroupNames.Room(roomId)).SendAsync("changed", ct);
        if (threadId is not null)
            await hub.Clients.Group(GroupNames.Thread(threadId.Value)).SendAsync("changed", ct);
    }

    private async Task BroadcastAsync(Guid roomId, Guid? threadRootId, string evt, object payload, CancellationToken ct)
    {
        await hub.Clients.Group(GroupNames.Room(roomId)).SendAsync(evt, payload, ct);
        if (threadRootId is not null)
            await hub.Clients.Group(GroupNames.Thread(threadRootId.Value)).SendAsync(evt, payload, ct);
        await MessageChangedAsync(roomId, threadRootId, ct); // legacy fallback
    }
}

// Snake_case on the wire (SignalR is configured with the same JSON policy as REST), so the
// `message` field is byte-identical to the REST MessageDto the client already consumes.
public record MessageCreatedEvent(MessageDto Message, Guid? RootId);
public record VoteChangedEvent(Guid MessageId, int Upvotes, Guid RoomId, Guid? RootId);
public record MessageDeletedEvent(Guid Id, Guid RoomId, Guid? RootId);
