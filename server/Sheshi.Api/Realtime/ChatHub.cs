using Microsoft.AspNetCore.SignalR;

namespace Sheshi.Api.Realtime;

// Intentionally not [Authorize]: this hub only carries room/thread presence and
// "changed" pings — the same public-read surface as the anonymous REST feeds.
// The JWT-from-query wiring still identifies authenticated callers when present,
// but anonymous visitors must be able to see live presence. No writes or
// sensitive data flow through here.
public class ChatHub(PresenceTracker presenceTracker) : Hub
{
    public async Task JoinRoom(Guid roomId)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, GroupNames.Room(roomId));
        var count = presenceTracker.JoinRoom(Context.ConnectionId, roomId);
        await Clients.Group(GroupNames.Room(roomId)).SendAsync("presence", new PresenceDto(roomId, count));
    }

    public async Task LeaveRoom(Guid roomId)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, GroupNames.Room(roomId));
        var count = presenceTracker.LeaveRoom(Context.ConnectionId, roomId);
        await Clients.Group(GroupNames.Room(roomId)).SendAsync("presence", new PresenceDto(roomId, count));
    }

    public Task JoinThread(Guid messageId) =>
        Groups.AddToGroupAsync(Context.ConnectionId, GroupNames.Thread(messageId));

    public Task LeaveThread(Guid messageId) =>
        Groups.RemoveFromGroupAsync(Context.ConnectionId, GroupNames.Thread(messageId));

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var changed = presenceTracker.Disconnect(Context.ConnectionId);
        foreach (var presence in changed)
            await Clients.Group(GroupNames.Room(presence.RoomId)).SendAsync("presence", presence);

        await base.OnDisconnectedAsync(exception);
    }
}
