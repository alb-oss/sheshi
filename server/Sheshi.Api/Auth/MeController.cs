using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Auth;

[ApiController]
[Authorize]
[Route("api/me")]
public class MeController(
    UserManager<ApplicationUser> userManager,
    TokenService tokenService) : ControllerBase
{
    [HttpGet]
    [EnableRateLimiting("reads")]
    public async Task<ActionResult<UserDto>> Get()
    {
        var user = await userManager.GetUserAsync(User);
        return user is null ? Unauthorized() : Ok(await tokenService.CreateUserDtoAsync(user));
    }

    [HttpPatch]
    [EnableRateLimiting("writes")]
    public async Task<ActionResult<UserDto>> Patch(UpdateProfileRequest request)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        user.DisplayName = Text.Clip(request.DisplayName, 60);
        var result = await userManager.UpdateAsync(user);
        if (!result.Succeeded) return BadRequest(new { errors = result.Errors.Select(e => e.Description).ToArray() });

        return Ok(await tokenService.CreateUserDtoAsync(user));
    }

}
