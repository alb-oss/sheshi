using System.Text.Json.Serialization;

namespace Sheshi.Api.Auth;

public record RegisterRequest(string Email, string Password, string? DisplayName);

public record LoginRequest(string Email, string Password);

public record RefreshRequest(string RefreshToken);

public record LogoutRequest(string RefreshToken);

public record ForgotPasswordRequest(string Email);

public record ResetPasswordRequest(string Email, string Token, string Password);

public record UpdateProfileRequest(string? DisplayName);

public record UserDto(
    Guid Id,
    string? Email,
    string? Username,
    string? DisplayName,
    string? AvatarUrl,
    string[] Roles,
    bool IsBanned);

public record AuthResponse(
    string AccessToken,
    string RefreshToken,
    UserDto User);
