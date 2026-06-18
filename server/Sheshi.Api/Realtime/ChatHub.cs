using Microsoft.AspNetCore.SignalR;

namespace Sheshi.Api.Realtime;

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

    // Live moderation queue — only moderators/admins may join (the JWT carries the role claims).
    // Fail closed: a non-moderator caller gets an explicit HubException rather than a silent no-op the
    // client can't distinguish from a successful subscribe.
    public Task JoinModeration()
    {
        if (Context.User?.IsInRole("moderator") != true && Context.User?.IsInRole("admin") != true)
            throw new HubException("FORBIDDEN");
        return Groups.AddToGroupAsync(Context.ConnectionId, GroupNames.Moderators());
    }

    public Task LeaveModeration() =>
        Groups.RemoveFromGroupAsync(Context.ConnectionId, GroupNames.Moderators());

    // The global proposals feed — open to everyone (anonymous included): proposal lists and vote tallies
    // are public. No presence is tracked here; it's a pure broadcast channel.
    public Task JoinProposals() =>
        Groups.AddToGroupAsync(Context.ConnectionId, GroupNames.Proposals());

    public Task LeaveProposals() =>
        Groups.RemoveFromGroupAsync(Context.ConnectionId, GroupNames.Proposals());

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var changed = presenceTracker.Disconnect(Context.ConnectionId);
        foreach (var presence in changed)
            await Clients.Group(GroupNames.Room(presence.RoomId)).SendAsync("presence", presence);

        await base.OnDisconnectedAsync(exception);
    }
}
