using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Sheshi.Api.Auth;
using Sheshi.Api.Features.Messages;

namespace Sheshi.Api.Features.Users;

[ApiController]
[Route("api/users")]
public class UsersController(MessageService messageService) : ControllerBase
{
    // A user's own posts/comments for their profile. Public (profiles are readable signed-out); the
    // caller's vote is folded in when authenticated. type=comments → replies, else posts.
    [EnableRateLimiting("reads")]
    [HttpGet("{id:guid}/messages")]
    public async Task<ActionResult<CursorPageDto<MessageDto>>> Messages(
        Guid id,
        [FromQuery] string? type,
        [FromQuery] int limit = 0,
        [FromQuery] string? cursor = null,
        CancellationToken ct = default)
    {
        var comments = string.Equals(type, "comments", StringComparison.OrdinalIgnoreCase);
        return Ok(await messageService.ListUserMessagesAsync(id, comments, User.GetUserId(), limit, cursor, ct));
    }
}
