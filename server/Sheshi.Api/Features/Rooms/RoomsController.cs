using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Features.Rooms;

[ApiController]
[Route("api/rooms")]
public class RoomsController(RoomService rooms) : ControllerBase
{
    [HttpGet]
    [EnableRateLimiting("reads")]
    public async Task<ActionResult<IReadOnlyList<RoomDto>>> List(CancellationToken ct)
    {
        return Ok(await rooms.ListAsync(ct));
    }

    [HttpGet("{slug}")]
    [EnableRateLimiting("reads")]
    public async Task<ActionResult<RoomDto>> GetBySlug(string slug, CancellationToken ct)
    {
        var room = await rooms.GetBySlugAsync(slug, ct);
        return room is null ? NotFound() : Ok(room);
    }

    [Authorize(Roles = Roles.Admin)]
    [EnableRateLimiting("writes")]
    [HttpPost]
    public async Task<ActionResult<RoomDto>> Create(CreateRoomRequest request, CancellationToken ct)
    {
        var result = await rooms.CreateAsync(request, ct);
        return result.Error switch
        {
            "ROOM_EXISTS" => Conflict(new { error = result.Error }),
            not null => BadRequest(new { error = result.Error }),
            _ => CreatedAtAction(nameof(GetBySlug), new { slug = result.Entity!.Slug }, result.Dto)
        };
    }
}
