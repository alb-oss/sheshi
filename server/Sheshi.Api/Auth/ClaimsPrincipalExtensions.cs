using System.Security.Claims;
using Microsoft.AspNetCore.Identity;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Auth;

public static class ClaimsPrincipalExtensions
{
    public static Guid? GetUserId(this ClaimsPrincipal principal)
    {
        var value = principal.FindFirstValue(ClaimTypes.NameIdentifier);
        return Guid.TryParse(value, out var id) ? id : null;
    }

    public static async Task<ApplicationUser?> GetUserAsync(
        this UserManager<ApplicationUser> userManager,
        ClaimsPrincipal principal)
    {
        var id = principal.GetUserId();
        return id is null ? null : await userManager.FindByIdAsync(id.Value.ToString());
    }
}
