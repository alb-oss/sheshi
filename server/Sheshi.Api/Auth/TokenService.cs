using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Auth;

public class TokenService(
    AppDbContext db,
    UserManager<ApplicationUser> userManager,
    IOptions<JwtOptions> jwtOptions)
{
    private readonly JwtOptions _jwt = jwtOptions.Value;

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
        var token = await db.RefreshTokens.SingleOrDefaultAsync(t => t.TokenHash == hash, ct);
        if (token is null || !token.IsActive) return null;

        var user = await userManager.FindByIdAsync(token.UserId.ToString());
        if (user is null) return null;

        token.RevokedAt = DateTimeOffset.UtcNow;
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
            new(JwtRegisteredClaimNames.Email, user.Email ?? ""),
            new(ClaimTypes.Email, user.Email ?? ""),
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
