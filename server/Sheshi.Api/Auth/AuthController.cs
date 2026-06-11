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
[EnableRateLimiting("auth")]
public class AuthController(
    UserManager<ApplicationUser> userManager,
    TokenService tokenService,
    IEmailSender emailSender,
    IConfiguration configuration,
    ILogger<AuthController> logger) : ControllerBase
{
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
            DisplayName = Text.Clip(request.DisplayName, 60) ?? email.Split('@')[0]
        };

        var result = await userManager.CreateAsync(user, request.Password);
        if (!result.Succeeded) return BadRequest(new { errors = result.Errors.Select(e => e.Description).ToArray() });

        await userManager.AddToRoleAsync(user, Roles.User);
        await SendConfirmationEmailAsync(user, ct);
        return Ok(await tokenService.CreateAuthResponseAsync(user, ct));
    }

    [HttpPost("confirm-email")]
    public async Task<IActionResult> ConfirmEmail(ConfirmEmailRequest request)
    {
        var email = NormalizeEmail(request.Email);
        if (email is null || string.IsNullOrWhiteSpace(request.Token))
            return BadRequest(new { error = "INVALID_CONFIRM_REQUEST" });

        var user = await userManager.FindByEmailAsync(email);
        if (user is null) return BadRequest(new { error = "INVALID_CONFIRM_REQUEST" });
        if (user.EmailConfirmed) return NoContent();

        var result = await userManager.ConfirmEmailAsync(user, request.Token);
        return result.Succeeded ? NoContent() : BadRequest(new { error = "INVALID_CONFIRM_REQUEST" });
    }

    private async Task SendConfirmationEmailAsync(ApplicationUser user, CancellationToken ct)
    {
        // Best-effort: a broken mail server must not block registration.
        try
        {
            var token = await userManager.GenerateEmailConfirmationTokenAsync(user);
            var confirmUrl = QueryHelpers.AddQueryString($"{FrontendBaseUrl()}/confirm-email", new Dictionary<string, string?>
            {
                ["email"] = user.Email,
                ["token"] = token
            });
            await emailSender.SendEmailConfirmationAsync(user.Email!, confirmUrl, ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Confirmation email for {Email} was not sent.", user.Email);
        }
    }

    [HttpPost("login")]
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest request, CancellationToken ct)
    {
        var email = NormalizeEmail(request.Email);
        if (email is null) return Unauthorized();

        var user = await userManager.FindByEmailAsync(email);
        if (user is null) return Unauthorized();
        if (await userManager.IsLockedOutAsync(user)) return Unauthorized();

        if (!await userManager.CheckPasswordAsync(user, request.Password))
        {
            // Per-account lockout (5 tries / 5 min) on top of the per-IP rate limit.
            await userManager.AccessFailedAsync(user);
            return Unauthorized();
        }

        await userManager.ResetAccessFailedCountAsync(user);
        if (user.IsBanned)
            return StatusCode(StatusCodes.Status403Forbidden, new { error = "ACCOUNT_BANNED" });

        return Ok(await tokenService.CreateAuthResponseAsync(user, ct));
    }

    [HttpPost("refresh")]
    public async Task<ActionResult<AuthResponse>> Refresh(RefreshRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.RefreshToken)) return Unauthorized();

        var response = await tokenService.RotateRefreshTokenAsync(request.RefreshToken, ct);
        return response is null ? Unauthorized() : Ok(response);
    }

    [Authorize]
    [HttpPost("logout")]
    public async Task<IActionResult> Logout(LogoutRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.RefreshToken)) return BadRequest(new { error = "MISSING_REFRESH_TOKEN" });

        await tokenService.RevokeRefreshTokenAsync(request.RefreshToken, ct);
        return NoContent();
    }

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

    [HttpPost("reset-password")]
    public async Task<IActionResult> ResetPassword(ResetPasswordRequest request)
    {
        var email = NormalizeEmail(request.Email);
        if (email is null || string.IsNullOrWhiteSpace(request.Token) || string.IsNullOrWhiteSpace(request.Password))
            return BadRequest(new { error = "INVALID_RESET_REQUEST" });

        var user = await userManager.FindByEmailAsync(email);
        if (user is null) return BadRequest(new { error = "INVALID_RESET_REQUEST" });

        var result = await userManager.ResetPasswordAsync(user, request.Token, request.Password);
        if (!result.Succeeded)
            return BadRequest(new { errors = result.Errors.Select(e => e.Description).ToArray() });

        // A password reset usually means "someone else may have my password":
        // kill every active session so the old credentials are worthless.
        await tokenService.RevokeAllForUserAsync(user.Id);
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

        var provider = result.Properties?.Items.TryGetValue("provider", out var storedProvider) == true ? storedProvider : null;
        var providerKey = result.Principal.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(provider) || string.IsNullOrWhiteSpace(providerKey))
            return BadRequest(new { error = "EXTERNAL_AUTH_FAILED" });

        // Identify by (provider, subject), never by email alone: email is only
        // used to link or create when no external login exists yet.
        var user = await userManager.FindByLoginAsync(provider, providerKey);
        if (user is null)
        {
            var email = result.Principal.FindFirstValue(ClaimTypes.Email);
            if (string.IsNullOrWhiteSpace(email)) return BadRequest(new { error = "EXTERNAL_EMAIL_MISSING" });

            user = await userManager.FindByEmailAsync(email);
            if (user is not null)
            {
                // Refuse to attach an external identity to a local account whose
                // email was never verified — otherwise anyone who pre-registers a
                // victim's address takes over their future OAuth sign-in.
                if (!user.EmailConfirmed) return ExternalFailureRedirect("EXTERNAL_ACCOUNT_CONFLICT");
            }
            else
            {
                user = new ApplicationUser
                {
                    Id = Guid.NewGuid(),
                    Email = email,
                    EmailConfirmed = true, // asserted by the OAuth provider
                    UserName = CreateUsername(email),
                    DisplayName = result.Principal.FindFirstValue(ClaimTypes.Name) ?? email.Split('@')[0],
                    AvatarUrl = result.Principal.FindFirstValue("urn:google:picture")
                };
                var create = await userManager.CreateAsync(user);
                if (!create.Succeeded) return BadRequest(new { errors = create.Errors.Select(e => e.Description).ToArray() });
                await userManager.AddToRoleAsync(user, Roles.User);
            }

            var link = await userManager.AddLoginAsync(user, new UserLoginInfo(provider, providerKey, provider));
            if (!link.Succeeded) return ExternalFailureRedirect("EXTERNAL_ACCOUNT_CONFLICT");
        }

        await HttpContext.SignOutAsync(AuthSchemes.External);
        if (user.IsBanned) return ExternalFailureRedirect("ACCOUNT_BANNED");

        var tokens = await tokenService.CreateAuthResponseAsync(user, ct);
        return Redirect($"{FrontendBaseUrl()}/auth/callback#access_token={Uri.EscapeDataString(tokens.AccessToken)}&refresh_token={Uri.EscapeDataString(tokens.RefreshToken)}");
    }

    private string FrontendBaseUrl() =>
        (configuration["Frontend:BaseUrl"] ?? "http://localhost:3000").TrimEnd('/');

    private RedirectResult ExternalFailureRedirect(string code) =>
        Redirect($"{FrontendBaseUrl()}/auth/callback#error={Uri.EscapeDataString(code)}");

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
