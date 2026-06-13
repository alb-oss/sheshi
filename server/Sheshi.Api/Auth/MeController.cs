using System.Security.Claims;
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
    public async Task<ActionResult<UserDto>> Get()
    {
        var user = await GetCurrentUserAsync();
        return user is null ? Unauthorized() : Ok(await tokenService.CreateUserDtoAsync(user));
    }

    [EnableRateLimiting("writes")]
    [HttpPatch]
    public async Task<ActionResult<UserDto>> Patch(UpdateProfileRequest request)
    {
        var user = await GetCurrentUserAsync();
        if (user is null) return Unauthorized();

        user.DisplayName = request.DisplayName?.Trim()[..Math.Min(request.DisplayName.Trim().Length, 60)];
        var result = await userManager.UpdateAsync(user);
        if (!result.Succeeded) return BadRequest(new { errors = result.Errors.Select(e => e.Description).ToArray() });

        return Ok(await tokenService.CreateUserDtoAsync(user));
    }

    private async Task<ApplicationUser?> GetCurrentUserAsync()
    {
        var id = User.FindFirstValue(ClaimTypes.NameIdentifier);
        return id is null ? null : await userManager.FindByIdAsync(id);
    }
}
