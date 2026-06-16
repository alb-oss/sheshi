using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.WebUtilities;
using Sheshi.Api.Domain;
using Sheshi.Api.Email;
using Sheshi.Api.Features.Users;

namespace Sheshi.Api.Auth;

[ApiController]
[Route("api/auth")]
public class AuthController(
    UserManager<ApplicationUser> userManager,
    TokenService tokenService,
    IEmailSender emailSender,
    IConfiguration configuration,
    PartitionedRateLimiter<string> accountLimiter) : ControllerBase
{
    [EnableRateLimiting("auth")]
    [HttpPost("register")]
    public async Task<ActionResult<AuthResponse>> Register(RegisterRequest request, CancellationToken ct)
    {
        var email = NormalizeEmail(request.Email);
        if (email is null || string.IsNullOrWhiteSpace(request.Password))
            return BadRequest(new { error = "INVALID_REGISTER_REQUEST" });

        // The user may pick a handle; if they leave it blank we generate an anonymous word-pair.
        // Either way the handle is never derived from the email, and the display name falls back to
        // it (not the email local part) so nothing leaks identity.
        string username;
        if (!string.IsNullOrWhiteSpace(request.Username))
        {
            username = request.Username.Trim().ToLowerInvariant();
            if (!UsernameGenerator.IsValid(username)) return BadRequest(new { error = "INVALID_USERNAME" });
        }
        else
        {
            username = UsernameGenerator.Anonymous();
        }

        var user = new ApplicationUser
        {
            Id = Guid.NewGuid(),
            Email = email,
            UserName = username,
            DisplayName = string.IsNullOrWhiteSpace(request.DisplayName)
                ? username
                : request.DisplayName.Trim()[..Math.Min(request.DisplayName.Trim().Length, 60)]
        };

        var result = await userManager.CreateAsync(user, request.Password);
        if (!result.Succeeded)
        {
            // A chosen handle that's taken comes back as a friendly 409 so the form can prompt for another.
            if (result.Errors.Any(e => e.Code == "DuplicateUserName")) return Conflict(new { error = "USERNAME_TAKEN" });
            return BadRequest(new { errors = result.Errors.Select(e => e.Description).ToArray() });
        }

        await userManager.AddToRoleAsync(user, Roles.User);
        var registered = await tokenService.CreateAuthResponseAsync(user, ct);
        tokenService.SetRefreshCookie(Response, registered.RefreshToken);
        return Ok(registered);
    }

    [EnableRateLimiting("auth")]
    [HttpPost("login")]
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest request, CancellationToken ct)
    {
        var email = NormalizeEmail(request.Email);
        if (email is null) return Unauthorized();

        // Per-account throttle: caps attempts against ONE email regardless of source IP, so credential
        // stuffing can't bypass the per-IP "auth" limit by rotating IPs.
        using var accountLease = accountLimiter.AttemptAcquire(email);
        if (!accountLease.IsAcquired)
            return StatusCode(StatusCodes.Status429TooManyRequests, new { error = "RATE_LIMITED" });

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

        var auth = await tokenService.CreateAuthResponseAsync(user, ct);
        tokenService.SetRefreshCookie(Response, auth.RefreshToken);
        return Ok(auth);
    }

    [EnableRateLimiting("auth")]
    [HttpPost("refresh")]
    public async Task<ActionResult<AuthResponse>> Refresh(RefreshRequest request, CancellationToken ct)
    {
        // Browser clients carry the token in the sheshi_rt cookie (nothing in the body); mobile/legacy
        // clients send it in the body. Prefer the cookie, fall back to the body.
        var rawToken = tokenService.ExtractRawRefreshToken(Request, request.RefreshToken);
        if (string.IsNullOrWhiteSpace(rawToken)) return Unauthorized();

        var response = await tokenService.RotateRefreshTokenAsync(rawToken, ct);
        if (response is null) return Unauthorized();
        tokenService.SetRefreshCookie(Response, response.RefreshToken);
        return Ok(response);
    }

    [Authorize]
    [EnableRateLimiting("auth")]
    [HttpPost("logout")]
    public async Task<IActionResult> Logout(LogoutRequest request, CancellationToken ct)
    {
        // Cookie-only browser logout sends no body; mobile sends the body token. Revoke whichever we
        // can find, then always clear the cookie so the browser session is fully gone.
        var rawToken = tokenService.ExtractRawRefreshToken(Request, request.RefreshToken);
        if (!string.IsNullOrWhiteSpace(rawToken))
            await tokenService.RevokeRefreshTokenAsync(rawToken, ct);
        tokenService.ClearRefreshCookie(Response);
        return NoContent();
    }

    [EnableRateLimiting("auth")]
    [HttpPost("forgot-password")]
    public async Task<IActionResult> ForgotPassword(ForgotPasswordRequest request, CancellationToken ct)
    {
        var email = NormalizeEmail(request.Email);
        if (email is null) return Ok();

        // Per-account throttle so one address can't be reset-email-bombed across IPs. Over-limit returns
        // the same Ok() as every other branch — never leak whether the account exists.
        using var accountLease = accountLimiter.AttemptAcquire(email);
        if (!accountLease.IsAcquired) return Ok();

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

        // The (provider, subject) pair is the only trustworthy identity from an external login.
        string? provider = null;
        result.Properties?.Items.TryGetValue("provider", out provider);
        var providerKey = result.Principal.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(provider) || string.IsNullOrWhiteSpace(providerKey))
            return BadRequest(new { error = "EXTERNAL_AUTH_FAILED" });

        // 1) Resolve by the linked external identity first — never by email alone.
        var user = await userManager.FindByLoginAsync(provider, providerKey);
        if (user is null)
        {
            var email = NormalizeEmail(result.Principal.FindFirstValue(ClaimTypes.Email));
            if (email is null) return BadRequest(new { error = "EXTERNAL_EMAIL_MISSING" });

            var existing = await userManager.FindByEmailAsync(email);
            if (existing is not null)
            {
                // 2) Never seize a local account via a matching email unless its owner has proven
                //    control of that email (confirmed). Otherwise an attacker controlling an OAuth
                //    account with the victim's email could take over the local account.
                if (!existing.EmailConfirmed) return BadRequest(new { error = "EXTERNAL_ACCOUNT_CONFLICT" });
                user = existing;
            }
            else
            {
                var oauthUsername = UsernameGenerator.Anonymous();
                user = new ApplicationUser
                {
                    Id = Guid.NewGuid(),
                    Email = email,
                    EmailConfirmed = true, // the provider has verified this address
                    UserName = oauthUsername,
                    DisplayName = result.Principal.FindFirstValue(ClaimTypes.Name) ?? oauthUsername,
                    AvatarUrl = result.Principal.FindFirstValue("urn:google:picture")
                };
                var create = await userManager.CreateAsync(user);
                if (!create.Succeeded) return BadRequest(new { errors = create.Errors.Select(e => e.Description).ToArray() });
                await userManager.AddToRoleAsync(user, Roles.User);
            }

            // 3) Record the external login so subsequent logins resolve by (provider, subject).
            var link = await userManager.AddLoginAsync(user, new UserLoginInfo(provider, providerKey, provider));
            if (!link.Succeeded) return BadRequest(new { errors = link.Errors.Select(e => e.Description).ToArray() });
        }

        if (user.IsBanned) return Forbid();

        await HttpContext.SignOutAsync(AuthSchemes.External);
        var tokens = await tokenService.CreateAuthResponseAsync(user, ct);
        tokenService.SetRefreshCookie(Response, tokens.RefreshToken);
        var frontend = (configuration["Frontend:BaseUrl"] ?? "http://localhost:3000").TrimEnd('/');
        // The refresh_token stays in the fragment for now so the current web callback keeps working;
        // the frontend cutover (PR2) reads the cookie and stops relying on the fragment.
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

}
