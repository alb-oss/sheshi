using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Sheshi.Api.Domain;
using Sheshi.Api.Features.Users;

namespace Sheshi.Api.Auth;

[ApiController]
[Authorize]
[Route("api/me")]
public class MeController(
    UserManager<ApplicationUser> userManager,
    TokenService tokenService,
    UserStatsService userStats) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<UserDto>> Get(CancellationToken ct)
    {
        var user = await GetCurrentUserAsync();
        return user is null ? Unauthorized() : Ok(await WithKarmaAsync(user, ct));
    }

    [EnableRateLimiting("writes")]
    [HttpPatch]
    public async Task<ActionResult<UserDto>> Patch(UpdateProfileRequest request, CancellationToken ct)
    {
        var user = await GetCurrentUserAsync();
        if (user is null) return Unauthorized();

        user.DisplayName = request.DisplayName?.Trim()[..Math.Min(request.DisplayName.Trim().Length, 60)];
        var result = await userManager.UpdateAsync(user);
        if (!result.Succeeded) return BadRequest(new { errors = result.Errors.Select(e => e.Description).ToArray() });

        return Ok(await WithKarmaAsync(user, ct));
    }

    // Karma is computed here (not in CreateUserDtoAsync) so login/refresh stay lean; clients read
    // /api/me as the authoritative user.
    private async Task<UserDto> WithKarmaAsync(ApplicationUser user, CancellationToken ct)
    {
        var dto = await tokenService.CreateUserDtoAsync(user);
        return dto with { Karma = await userStats.GetKarmaAsync(user.Id, ct) };
    }

    private async Task<ApplicationUser?> GetCurrentUserAsync()
    {
        var id = User.FindFirstValue(ClaimTypes.NameIdentifier);
        return id is null ? null : await userManager.FindByIdAsync(id);
    }
}
