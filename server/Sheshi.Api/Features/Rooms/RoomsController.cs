using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Sheshi.Api.Data;

namespace Sheshi.Api.Features.Rooms;

[ApiController]
[Route("api/rooms")]
public class RoomsController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<RoomDto>>> List(CancellationToken ct)
    {
        var rooms = await db.Rooms
            .AsNoTracking()
            .OrderBy(r => r.Name)
            .Select(r => new RoomDto(r.Id, r.Slug, r.Name, r.Description))
            .ToListAsync(ct);

        return Ok(rooms);
    }

    [HttpGet("{slug}")]
    public async Task<ActionResult<RoomDto>> GetBySlug(string slug, CancellationToken ct)
    {
        var room = await db.Rooms
            .AsNoTracking()
            .Where(r => r.Slug == slug)
            .Select(r => new RoomDto(r.Id, r.Slug, r.Name, r.Description))
            .SingleOrDefaultAsync(ct);

        return room is null ? NotFound() : Ok(room);
    }
}
