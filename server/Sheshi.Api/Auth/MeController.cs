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

        if (request.Username is not null)
        {
            var username = request.Username.Trim().ToLowerInvariant();
            if (!UsernameGenerator.IsValid(username))
                return BadRequest(new { error = "INVALID_USERNAME" });
            if (!string.Equals(username, user.UserName, StringComparison.OrdinalIgnoreCase))
            {
                // SetUserNameAsync persists and re-validates uniqueness; trust its result over the
                // pre-check to avoid a check-then-set race.
                var setResult = await userManager.SetUserNameAsync(user, username);
                if (!setResult.Succeeded)
                    return setResult.Errors.Any(e => e.Code == "DuplicateUserName")
                        ? Conflict(new { error = "USERNAME_TAKEN" })
                        : BadRequest(new { error = "INVALID_USERNAME" });
            }
        }

        // Only touch the display name when the caller sends one (partial updates from the username editor).
        if (request.DisplayName is not null)
            user.DisplayName = request.DisplayName.Trim()[..Math.Min(request.DisplayName.Trim().Length, 60)];

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
