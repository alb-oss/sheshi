using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Identity;
using Sheshi.Api.Auth;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Features.Users;

[ApiController]
[Route("api/usernames")]
public class UsernamesController(UserManager<ApplicationUser> userManager) : ControllerBase
{
    // A few free, anonymous handle suggestions for the shuffle button. Public on purpose — it's used
    // both on the signup form (no session yet) and on the profile editor.
    [HttpGet("suggestions")]
    public async Task<ActionResult<UsernameSuggestionsDto>> Suggestions()
    {
        var suggestions = new List<string>();
        for (var attempt = 0; attempt < 25 && suggestions.Count < 5; attempt++)
        {
            var candidate = UsernameGenerator.Suggestion();
            if (suggestions.Contains(candidate)) continue;
            if (await userManager.FindByNameAsync(candidate) is null)
                suggestions.Add(candidate);
        }
        return Ok(new UsernameSuggestionsDto(suggestions));
    }
}
