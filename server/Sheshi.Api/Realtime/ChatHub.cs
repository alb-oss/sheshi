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
    public Task JoinModeration() =>
        Context.User?.IsInRole("moderator") == true || Context.User?.IsInRole("admin") == true
            ? Groups.AddToGroupAsync(Context.ConnectionId, GroupNames.Moderators())
            : Task.CompletedTask;

    public Task LeaveModeration() =>
        Groups.RemoveFromGroupAsync(Context.ConnectionId, GroupNames.Moderators());

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var changed = presenceTracker.Disconnect(Context.ConnectionId);
        foreach (var presence in changed)
            await Clients.Group(GroupNames.Room(presence.RoomId)).SendAsync("presence", presence);

        await base.OnDisconnectedAsync(exception);
    }
}
