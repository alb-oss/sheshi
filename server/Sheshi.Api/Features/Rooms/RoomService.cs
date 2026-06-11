using Sheshi.Api.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Features.Rooms;

/// <summary>Cache key for the full room list. Evicted whenever a room's
/// denormalized counters change (new room, post, or delete).</summary>
public static class RoomsCache
{
    public const string ListKey = "rooms:list:v1";
}

public class RoomService(AppDbContext db, IMemoryCache cache)
{
    private static readonly TimeSpan ListTtl = TimeSpan.FromSeconds(30);

    public async Task<IReadOnlyList<RoomDto>> ListAsync(CancellationToken ct = default)
    {
        if (cache.TryGetValue(RoomsCache.ListKey, out IReadOnlyList<RoomDto>? cached) && cached is not null)
            return cached;

        var rooms = await db.Rooms
            .AsNoTracking()
            .OrderBy(r => r.Name)
            .ToListAsync(ct);

        var dtos = rooms.Select(ToDto).ToList();
        cache.Set(RoomsCache.ListKey, (IReadOnlyList<RoomDto>)dtos, ListTtl);
        return dtos;
    }

    public async Task<RoomDto?> GetBySlugAsync(string slug, CancellationToken ct = default)
    {
        var room = await db.Rooms
            .AsNoTracking()
            .SingleOrDefaultAsync(r => r.Slug == slug, ct);

        return room is null ? null : ToDto(room);
    }

    public async Task<CreateRoomResult> CreateAsync(CreateRoomRequest request, CancellationToken ct = default)
    {
        var name = NormalizeName(request.Name);
        if (name is null) return CreateRoomResult.Failed("ROOM_NAME_REQUIRED");

        var slug = NormalizeSlug(request.Slug) ?? NormalizeSlug(name.TrimStart('#'));
        if (slug is null) return CreateRoomResult.Failed("ROOM_SLUG_REQUIRED");

        if (await db.Rooms.AnyAsync(r => r.Slug == slug, ct))
            return CreateRoomResult.Failed("ROOM_EXISTS");

        var room = new Room
        {
            Slug = slug,
            Name = name.StartsWith('#') ? name : $"#{name}",
            Description = string.IsNullOrWhiteSpace(request.Description)
                ? null
                : request.Description.Trim()[..Math.Min(request.Description.Trim().Length, 180)]
        };
        db.Rooms.Add(room);
        await db.SaveChangesAsync(ct);
        cache.Remove(RoomsCache.ListKey);

        return CreateRoomResult.Created(room, ToDto(room));
    }

    // Counters are denormalized onto Room, so a DTO is a pure projection — no GROUP BY.
    private static RoomDto ToDto(Room r) =>
        new(r.Id, r.Slug, r.Name, r.Description, r.ThreadCount, r.LatestActivityAt);

    private static string? NormalizeName(string? name)
    {
        name = name?.Trim();
        if (string.IsNullOrWhiteSpace(name)) return null;
        return name[..Math.Min(name.Length, 60)];
    }

    private static string? NormalizeSlug(string? slug) => Slug.Normalize(slug);
}

public sealed record CreateRoomResult(Room? Entity, RoomDto? Dto, string? Error)
{
    public static CreateRoomResult Created(Room entity, RoomDto dto) => new(entity, dto, null);
    public static CreateRoomResult Failed(string error) => new(null, null, error);
}
