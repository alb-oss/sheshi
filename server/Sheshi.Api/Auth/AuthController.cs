using System.Security.Claims;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.WebUtilities;
using Sheshi.Api.Domain;
using Sheshi.Api.Email;

namespace Sheshi.Api.Auth;

[ApiController]
[Route("api/auth")]
public class AuthController(
    UserManager<ApplicationUser> userManager,
    TokenService tokenService,
    IEmailSender emailSender,
    IConfiguration configuration) : ControllerBase
{
    [EnableRateLimiting("auth")]
    [HttpPost("register")]
    public async Task<ActionResult<AuthResponse>> Register(RegisterRequest request, CancellationToken ct)
    {
        var email = NormalizeEmail(request.Email);
        if (email is null || string.IsNullOrWhiteSpace(request.Password))
            return BadRequest(new { error = "INVALID_REGISTER_REQUEST" });

        var user = new ApplicationUser
        {
            Id = Guid.NewGuid(),
            Email = email,
            UserName = CreateUsername(email),
            DisplayName = string.IsNullOrWhiteSpace(request.DisplayName)
                ? email.Split('@')[0]
                : request.DisplayName.Trim()[..Math.Min(request.DisplayName.Trim().Length, 60)]
        };

        var result = await userManager.CreateAsync(user, request.Password);
        if (!result.Succeeded) return BadRequest(new { errors = result.Errors.Select(e => e.Description).ToArray() });

        await userManager.AddToRoleAsync(user, Roles.User);
        return Ok(await tokenService.CreateAuthResponseAsync(user, ct));
    }

    [EnableRateLimiting("auth")]
    [HttpPost("login")]
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest request, CancellationToken ct)
    {
        var email = NormalizeEmail(request.Email);
        if (email is null) return Unauthorized();

        var user = await userManager.FindByEmailAsync(email);
        if (user is null)
            return Unauthorized();
        if (user.IsBanned) return Forbid();
        if (await userManager.IsLockedOutAsync(user)) return StatusCode(StatusCodes.Status423Locked);

        if (!await userManager.CheckPasswordAsync(user, request.Password))
        {
            await userManager.AccessFailedAsync(user);
            return Unauthorized();
        }

        if (await userManager.GetAccessFailedCountAsync(user) > 0)
            await userManager.ResetAccessFailedCountAsync(user);

        return Ok(await tokenService.CreateAuthResponseAsync(user, ct));
    }

    [EnableRateLimiting("auth")]
    [HttpPost("refresh")]
    public async Task<ActionResult<AuthResponse>> Refresh(RefreshRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.RefreshToken)) return Unauthorized();

        var response = await tokenService.RotateRefreshTokenAsync(request.RefreshToken, ct);
        return response is null ? Unauthorized() : Ok(response);
    }

    [Authorize]
    [EnableRateLimiting("auth")]
    [HttpPost("logout")]
    public async Task<IActionResult> Logout(LogoutRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.RefreshToken)) return BadRequest(new { error = "MISSING_REFRESH_TOKEN" });

        await tokenService.RevokeRefreshTokenAsync(request.RefreshToken, ct);
        return NoContent();
    }

    [EnableRateLimiting("auth")]
    [HttpPost("forgot-password")]
    public async Task<IActionResult> ForgotPassword(ForgotPasswordRequest request, CancellationToken ct)
    {
        var email = NormalizeEmail(request.Email);
        if (email is null) return Ok();

        var user = await userManager.FindByEmailAsync(email);
        if (user is null) return Ok();

        var token = await userManager.GeneratePasswordResetTokenAsync(user);
        var frontend = (configuration["Frontend:BaseUrl"] ?? "http://localhost:3000").TrimEnd('/');
        var resetUrl = QueryHelpers.AddQueryString($"{frontend}/reset-password", new Dictionary<string, string?>
        {
            ["email"] = email,
            ["token"] = token
        });
        await emailSender.SendPasswordResetAsync(email, resetUrl, ct);
        return Ok();
    }

    [EnableRateLimiting("auth")]
    [HttpPost("reset-password")]
    public async Task<IActionResult> ResetPassword(ResetPasswordRequest request, CancellationToken ct)
    {
        var email = NormalizeEmail(request.Email);
        if (email is null || string.IsNullOrWhiteSpace(request.Token) || string.IsNullOrWhiteSpace(request.Password))
            return BadRequest(new { error = "INVALID_RESET_REQUEST" });

        var user = await userManager.FindByEmailAsync(email);
        if (user is null) return BadRequest(new { error = "INVALID_RESET_REQUEST" });

        var result = await userManager.ResetPasswordAsync(user, request.Token, request.Password);
        if (!result.Succeeded) return BadRequest(new { errors = result.Errors.Select(e => e.Description).ToArray() });

        await tokenService.RevokeAllRefreshTokensAsync(user.Id, ct);
        return NoContent();
    }

    [HttpGet("providers")]
    public ActionResult<string[]> Providers() => Ok(GetEnabledProviders().ToArray());

    [HttpGet("external/{provider}")]
    public IActionResult External(string provider)
    {
        provider = provider.ToLowerInvariant();
        if (!GetEnabledProviders().Contains(provider)) return NotFound();

        var callback = Url.Action(nameof(ExternalCallback), "Auth", values: null, protocol: Request.Scheme);
        var properties = new AuthenticationProperties { RedirectUri = callback };
        properties.Items["provider"] = provider;
        return Challenge(properties, provider);
    }

    [HttpGet("external/callback")]
    public async Task<IActionResult> ExternalCallback(CancellationToken ct)
    {
        var result = await HttpContext.AuthenticateAsync(AuthSchemes.External);
        if (!result.Succeeded || result.Principal is null) return BadRequest(new { error = "EXTERNAL_AUTH_FAILED" });

        var email = result.Principal.FindFirstValue(ClaimTypes.Email);
        if (string.IsNullOrWhiteSpace(email)) return BadRequest(new { error = "EXTERNAL_EMAIL_MISSING" });

        var user = await userManager.FindByEmailAsync(email);
        if (user is null)
        {
            user = new ApplicationUser
            {
                Id = Guid.NewGuid(),
                Email = email,
                UserName = CreateUsername(email),
                DisplayName = result.Principal.FindFirstValue(ClaimTypes.Name) ?? email.Split('@')[0],
                AvatarUrl = result.Principal.FindFirstValue("urn:google:picture")
            };
            var create = await userManager.CreateAsync(user);
            if (!create.Succeeded) return BadRequest(new { errors = create.Errors.Select(e => e.Description).ToArray() });
            await userManager.AddToRoleAsync(user, Roles.User);
        }

        await HttpContext.SignOutAsync(AuthSchemes.External);
        var tokens = await tokenService.CreateAuthResponseAsync(user, ct);
        var frontend = (configuration["Frontend:BaseUrl"] ?? "http://localhost:3000").TrimEnd('/');
        return Redirect($"{frontend}/auth/callback#access_token={Uri.EscapeDataString(tokens.AccessToken)}&refresh_token={Uri.EscapeDataString(tokens.RefreshToken)}");
    }

    private IEnumerable<string> GetEnabledProviders()
    {
        if (HasClientSecret("Authentication:Google")) yield return "google";
        if (HasClientSecret("Authentication:Microsoft")) yield return "microsoft";

        var apple = configuration.GetSection("Authentication:Apple");
        if (!string.IsNullOrWhiteSpace(apple["ClientId"]) &&
            !string.IsNullOrWhiteSpace(apple["TeamId"]) &&
            !string.IsNullOrWhiteSpace(apple["KeyId"]) &&
            !string.IsNullOrWhiteSpace(apple["PrivateKey"]))
        {
            yield return "apple";
        }
    }

    private bool HasClientSecret(string sectionName)
    {
        var section = configuration.GetSection(sectionName);
        return !string.IsNullOrWhiteSpace(section["ClientId"]) &&
               !string.IsNullOrWhiteSpace(section["ClientSecret"]);
    }

    private static string? NormalizeEmail(string? email)
    {
        email = email?.Trim().ToLowerInvariant();
        return string.IsNullOrWhiteSpace(email) || !email.Contains('@') ? null : email;
    }

    private static string CreateUsername(string email)
    {
        var id = Guid.NewGuid().ToString("N")[..4];
        var local = Regex.Replace(email.Split('@')[0].ToLowerInvariant(), "[^a-z0-9_]+", "_").Trim('_');
        if (string.IsNullOrWhiteSpace(local)) local = "user";
        return $"{local}_{id}";
    }
}
