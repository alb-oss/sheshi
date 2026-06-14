using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Sheshi.Api.Domain;
using Sheshi.Api.Features.Moderation;
using Sheshi.Api.Realtime;

namespace Sheshi.Api.Features.Rooms;

[ApiController]
[Route("api/rooms")]
public class RoomsController(RoomService rooms, ModerationActionLogger actionLogger, RealtimeNotifier realtime) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<RoomDto>>> List(CancellationToken ct)
    {
        return Ok(await rooms.ListAsync(ct));
    }

    [HttpGet("{slug}")]
    public async Task<ActionResult<RoomDto>> GetBySlug(string slug, CancellationToken ct)
    {
        var room = await rooms.GetBySlugAsync(slug, ct);
        return room is null ? NotFound() : Ok(room);
    }

    [Authorize(Roles = Roles.Admin)]
    [EnableRateLimiting("moderation")]
    [HttpPost]
    public async Task<ActionResult<RoomDto>> Create(CreateRoomRequest request, CancellationToken ct)
    {
        var result = await rooms.CreateAsync(request, ct);
        if (result.Error == "ROOM_EXISTS") return Conflict(new { error = result.Error });
        if (result.Error is not null) return BadRequest(new { error = result.Error });

        await actionLogger.LogAsync(User, ModerationActionTypes.RoomCreated, "room", result.Entity!.Id, ct: ct);
        await realtime.RoomCreatedAsync(result.Dto!, ct); // appears in every sidebar/grid live
        return CreatedAtAction(nameof(GetBySlug), new { slug = result.Entity.Slug }, result.Dto);
    }
}
