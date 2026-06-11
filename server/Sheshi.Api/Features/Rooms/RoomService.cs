using Microsoft.EntityFrameworkCore;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Features.Rooms;

public class RoomService(AppDbContext db)
{
    public async Task<IReadOnlyList<RoomDto>> ListAsync(CancellationToken ct = default)
    {
        var rooms = await db.Rooms
            .AsNoTracking()
            .OrderBy(r => r.Name)
            .ToListAsync(ct);

        return await ToDtosAsync(rooms, ct);
    }

    public async Task<RoomDto?> GetBySlugAsync(string slug, CancellationToken ct = default)
    {
        var room = await db.Rooms
            .AsNoTracking()
            .SingleOrDefaultAsync(r => r.Slug == slug, ct);

        return room is null ? null : (await ToDtosAsync([room], ct)).Single();
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

        return CreateRoomResult.Created(room, (await ToDtosAsync([room], ct)).Single());
    }

    private async Task<IReadOnlyList<RoomDto>> ToDtosAsync(IReadOnlyList<Room> rooms, CancellationToken ct)
    {
        if (rooms.Count == 0) return [];

        var roomIds = rooms.Select(r => r.Id).ToArray();

        var threadCounts = await db.Messages
            .AsNoTracking()
            .Where(m => roomIds.Contains(m.RoomId) && m.ParentId == null && m.DeletedAt == null)
            .GroupBy(m => m.RoomId)
            .Select(g => new { RoomId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.RoomId, x => x.Count, ct);

        var latestActivity = await db.Messages
            .AsNoTracking()
            .Where(m => roomIds.Contains(m.RoomId))
            .GroupBy(m => m.RoomId)
            .Select(g => new { RoomId = g.Key, LatestAt = g.Max(m => m.CreatedAt) })
            .ToDictionaryAsync(x => x.RoomId, x => (DateTimeOffset?)x.LatestAt, ct);

        return rooms.Select(r => new RoomDto(
            r.Id,
            r.Slug,
            r.Name,
            r.Description,
            threadCounts.GetValueOrDefault(r.Id),
            latestActivity.GetValueOrDefault(r.Id))).ToList();
    }

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
