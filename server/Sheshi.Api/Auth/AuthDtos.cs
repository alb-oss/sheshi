using System.Text.Json.Serialization;

namespace Sheshi.Api.Auth;

public record RegisterRequest(string Email, string Password, string? DisplayName);

public record LoginRequest(string Email, string Password);

public record RefreshRequest(string RefreshToken);

public record LogoutRequest(string RefreshToken);

public record ForgotPasswordRequest(string Email);

public record ResetPasswordRequest(string Email, string Token, string Password);

public record UpdateProfileRequest(string? DisplayName, string? Username = null);

public record UsernameSuggestionsDto(IReadOnlyList<string> Suggestions);

public record UserDto(
    Guid Id,
    string? Email,
    string? Username,
    string? DisplayName,
    string? AvatarUrl,
    string[] Roles,
    bool IsBanned,
    // Reputation score. Defaults to 0 on login/refresh payloads (kept lean) and is filled in by
    // GET /api/me, which clients read as the authoritative user. See UserStatsService.
    int Karma = 0);

public record AuthResponse(
    string AccessToken,
    string RefreshToken,
    UserDto User);
