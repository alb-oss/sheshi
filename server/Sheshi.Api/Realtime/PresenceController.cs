using Microsoft.AspNetCore.Mvc;

namespace Sheshi.Api.Realtime;

[ApiController]
[Route("api/rooms/presence")]
public class PresenceController(PresenceTracker presenceTracker) : ControllerBase
{
    [HttpGet]
    public ActionResult<IReadOnlyDictionary<string, int>> Get()
    {
        var snapshot = presenceTracker.Snapshot()
            .ToDictionary(kvp => kvp.Key.ToString(), kvp => kvp.Value);

        return Ok(snapshot);
    }
}
