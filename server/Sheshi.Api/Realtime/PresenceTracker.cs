using System.Collections.Concurrent;

namespace Sheshi.Api.Realtime;

public class PresenceTracker
{
    private readonly object _gate = new();
    private readonly Dictionary<Guid, HashSet<string>> _rooms = [];
    private readonly Dictionary<string, HashSet<Guid>> _connections = [];

    public int JoinRoom(string connectionId, Guid roomId)
    {
        lock (_gate)
        {
            if (!_rooms.TryGetValue(roomId, out var connections))
            {
                connections = [];
                _rooms[roomId] = connections;
            }
            connections.Add(connectionId);

            if (!_connections.TryGetValue(connectionId, out var rooms))
            {
                rooms = [];
                _connections[connectionId] = rooms;
            }
            rooms.Add(roomId);

            return connections.Count;
        }
    }

    public int LeaveRoom(string connectionId, Guid roomId)
    {
        lock (_gate)
        {
            if (_connections.TryGetValue(connectionId, out var rooms))
            {
                rooms.Remove(roomId);
                if (rooms.Count == 0) _connections.Remove(connectionId);
            }

            if (!_rooms.TryGetValue(roomId, out var connections)) return 0;
            connections.Remove(connectionId);
            var count = connections.Count;
            if (count == 0) _rooms.Remove(roomId);
            return count;
        }
    }

    public IReadOnlyList<PresenceDto> Disconnect(string connectionId)
    {
        lock (_gate)
        {
            if (!_connections.Remove(connectionId, out var rooms)) return [];

            var changed = new List<PresenceDto>();
            foreach (var roomId in rooms)
            {
                if (!_rooms.TryGetValue(roomId, out var connections)) continue;
                connections.Remove(connectionId);
                var count = connections.Count;
                if (count == 0) _rooms.Remove(roomId);
                changed.Add(new PresenceDto(roomId, count));
            }
            return changed;
        }
    }

    public IReadOnlyDictionary<Guid, int> Snapshot()
    {
        lock (_gate)
        {
            return _rooms.ToDictionary(kvp => kvp.Key, kvp => kvp.Value.Count);
        }
    }
}
