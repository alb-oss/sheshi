using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Auth;

public class TokenService(
    AppDbContext db,
    UserManager<ApplicationUser> userManager,
    IOptions<JwtOptions> jwtOptions,
    IWebHostEnvironment env)
{
    private readonly JwtOptions _jwt = jwtOptions.Value;

    // --- Refresh-token cookie (browser clients) ---------------------------------------------------
    // The refresh token rides in an HttpOnly + SameSite=Lax cookie scoped to /api/auth so it is never
    // readable by JS (an XSS can't lift it) and is only sent to the auth endpoints. Secure is on
    // outside Development (Development uses the http TestServer / localhost). Mobile clients ignore the
    // cookie and keep using the body token; the auth endpoints read the cookie first, body second.

    public void SetRefreshCookie(HttpResponse response, string refreshToken) =>
        response.Cookies.Append(_jwt.RefreshCookieName, refreshToken,
            BuildCookieOptions(DateTimeOffset.UtcNow.AddDays(_jwt.RefreshTokenDays)));

    public void ClearRefreshCookie(HttpResponse response) =>
        response.Cookies.Append(_jwt.RefreshCookieName, "", BuildCookieOptions(DateTimeOffset.UnixEpoch));

    public string? ExtractRawRefreshToken(HttpRequest request, string? bodyToken)
    {
        var cookie = request.Cookies[_jwt.RefreshCookieName];
        return !string.IsNullOrWhiteSpace(cookie) ? cookie : bodyToken;
    }

    private CookieOptions BuildCookieOptions(DateTimeOffset expires) => new()
    {
        HttpOnly = true,
        Secure = !env.IsDevelopment(),
        SameSite = SameSiteMode.Lax,
        Path = "/api/auth",
        Domain = string.IsNullOrWhiteSpace(_jwt.CookieDomain) ? null : _jwt.CookieDomain,
        Expires = expires,
        IsEssential = true,
    };

    public async Task<AuthResponse> CreateAuthResponseAsync(ApplicationUser user, CancellationToken ct = default)
    {
        var accessToken = await CreateAccessTokenAsync(user);
        var refreshToken = CreateRawRefreshToken();

        db.RefreshTokens.Add(new RefreshToken
        {
            UserId = user.Id,
            TokenHash = HashRefreshToken(refreshToken),
            ExpiresAt = DateTimeOffset.UtcNow.AddDays(_jwt.RefreshTokenDays)
        });
        await db.SaveChangesAsync(ct);

        return new AuthResponse(accessToken, refreshToken, await CreateUserDtoAsync(user));
    }

    public async Task<AuthResponse?> RotateRefreshTokenAsync(string rawToken, CancellationToken ct = default)
    {
        var hash = HashRefreshToken(rawToken);
        var token = await db.RefreshTokens.AsNoTracking().SingleOrDefaultAsync(t => t.TokenHash == hash, ct);
        if (token is null) return null;

        // Replay detection: a refresh on an already-revoked-but-not-expired token means a
        // previously-rotated (possibly stolen) token is being reused → revoke every session.
        if (token.RevokedAt is not null && token.ExpiresAt > DateTimeOffset.UtcNow)
        {
            await RevokeAllRefreshTokensAsync(token.UserId, ct);
            return null;
        }
        if (!token.IsActive) return null;

        // Single-use, atomically: only one concurrent caller wins the revoke (1 row updated);
        // racers see 0 rows and are rejected, so a token can never fork two live sessions.
        var revoked = await db.RefreshTokens
            .Where(t => t.Id == token.Id && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, DateTimeOffset.UtcNow), ct);
        if (revoked == 0) return null;

        var user = await userManager.FindByIdAsync(token.UserId.ToString());
        if (user is null) return null;

        return await CreateAuthResponseAsync(user, ct);
    }

    public async Task<bool> RevokeRefreshTokenAsync(string rawToken, CancellationToken ct = default)
    {
        var hash = HashRefreshToken(rawToken);
        var token = await db.RefreshTokens.SingleOrDefaultAsync(t => t.TokenHash == hash, ct);
        if (token is null || token.RevokedAt is not null) return false;

        token.RevokedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<int> RevokeAllRefreshTokensAsync(Guid userId, CancellationToken ct = default)
    {
        var activeTokens = await db.RefreshTokens
            .Where(t => t.UserId == userId && t.RevokedAt == null && t.ExpiresAt > DateTimeOffset.UtcNow)
            .ToListAsync(ct);

        foreach (var token in activeTokens)
            token.RevokedAt = DateTimeOffset.UtcNow;

        await db.SaveChangesAsync(ct);
        return activeTokens.Count;
    }

    public async Task<UserDto> CreateUserDtoAsync(ApplicationUser user)
    {
        var roles = await userManager.GetRolesAsync(user);
        return new UserDto(
            user.Id,
            user.Email,
            user.UserName,
            user.DisplayName,
            user.AvatarUrl,
            roles.Order(StringComparer.Ordinal).ToArray(),
            user.IsBanned);
    }

    private async Task<string> CreateAccessTokenAsync(ApplicationUser user)
    {
        var roles = await userManager.GetRolesAsync(user);
        var now = DateTimeOffset.UtcNow;
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Name, user.DisplayName ?? user.UserName ?? "")
        };
        claims.AddRange(roles.Select(role => new Claim(ClaimTypes.Role, role)));

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_jwt.SigningKey));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            issuer: _jwt.Issuer,
            audience: _jwt.Audience,
            claims: claims,
            notBefore: now.UtcDateTime,
            expires: now.AddMinutes(_jwt.AccessTokenMinutes).UtcDateTime,
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private static string CreateRawRefreshToken() =>
        WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(64));

    private static string HashRefreshToken(string rawToken) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(rawToken)));
}
