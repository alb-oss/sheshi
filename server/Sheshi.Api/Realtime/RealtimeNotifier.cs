using Microsoft.AspNetCore.SignalR;

namespace Sheshi.Api.Realtime;

public class RealtimeNotifier(IHubContext<ChatHub> hub)
{
    public async Task MessageChangedAsync(MessageChangeDto change, CancellationToken ct = default)
    {
        await hub.Clients.Group(GroupNames.Room(change.RoomId)).SendAsync("changed", cancellationToken: ct);
        await hub.Clients.Group(GroupNames.Room(change.RoomId)).SendAsync("message_changed", change, ct);

        if (change.ThreadId is not null)
        {
            await hub.Clients.Group(GroupNames.Thread(change.ThreadId.Value)).SendAsync("changed", cancellationToken: ct);
            await hub.Clients.Group(GroupNames.Thread(change.ThreadId.Value)).SendAsync("message_changed", change, ct);
        }
    }
}

public record MessageChangeDto(string Type, Guid RoomId, Guid? ThreadId, Guid? MessageId);
