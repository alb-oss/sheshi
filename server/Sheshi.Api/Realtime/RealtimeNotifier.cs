using Microsoft.AspNetCore.SignalR;

namespace Sheshi.Api.Realtime;

public class RealtimeNotifier(IHubContext<ChatHub> hub)
{
    public async Task MessageChangedAsync(Guid roomId, Guid? threadId = null, CancellationToken ct = default)
    {
        await hub.Clients.Group(GroupNames.Room(roomId)).SendAsync("changed", cancellationToken: ct);
        if (threadId is not null)
            await hub.Clients.Group(GroupNames.Thread(threadId.Value)).SendAsync("changed", cancellationToken: ct);
    }
}
