using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using FluentAssertions;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Tests;

// Regression for incomplete ban enforcement. Post/vote already gated on IsBanned, but report,
// PATCH /api/me, and refresh-token rotation did not — a banned user could still feed the moderation
// queue, rename themselves, and mint fresh access tokens off a still-valid refresh token. The ban
// gate is now centralized: every write path fails closed (403 FORBIDDEN), and a banned owner's
// refresh is rejected (401) with all their sessions revoked.
public class BanEnforcementTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Banned_user_cannot_report_or_patch_profile_and_cannot_refresh_tokens()
    {
        var client = factory.CreateClient();
        var author = await RegisterAsync(client, "ban-author");
        var banned = await RegisterAsync(client, "ban-target");
        var room = await GetRoomAsync(client, "sheshi");

        // A non-banned author posts a message the banned user could try to report.
        UseBearer(client, author.AccessToken);
        var target = await (await client.PostAsJsonAsync("/api/messages",
            new { room_id = room.Id, body = "report target" })).Content.ReadFromJsonAsync<MessageDto>();
        target.Should().NotBeNull();

        // Ban the target AFTER it minted a valid access token + refresh token — the access token is
        // still cryptographically valid (ban happens mid-session), which is exactly the gap.
        await WithServicesAsync(async sp =>
        {
            var userManager = sp.GetRequiredService<UserManager<ApplicationUser>>();
            var bannedUser = await userManager.FindByEmailAsync(banned.Email);
            bannedUser!.BannedAt = DateTimeOffset.UtcNow;
            await userManager.UpdateAsync(bannedUser);
        });

        UseBearer(client, banned.AccessToken);

        // Baseline: a banned post is the established FORBIDDEN behavior the other paths must mirror.
        var bannedPost = await client.PostAsJsonAsync("/api/messages",
            new { room_id = room.Id, body = "should be blocked" });
        bannedPost.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        // (a) Report — a write feeding the moderation queue — must be the SAME forbidden response.
        var bannedReport = await client.PostAsJsonAsync($"/api/messages/{target!.Id}/report",
            new { reason = "spam", note = "abuse" });
        bannedReport.StatusCode.Should().Be(HttpStatusCode.Forbidden,
            "a banned user must not be able to submit a report (same gate as a banned post)");

        // (b) PATCH /api/me — profile mutation — must be the SAME forbidden response.
        var bannedPatch = await client.PatchAsJsonAsync("/api/me", new { display_name = "Evasion" });
        bannedPatch.StatusCode.Should().Be(HttpStatusCode.Forbidden,
            "a banned user must not be able to mutate their profile (same gate as a banned post)");

        // (c) Refresh rotation — a banned user holding a still-valid refresh token must NOT be able to
        // rotate it into a fresh access token. Use a cookie-free client so ONLY the body token is
        // presented (the WAF client used above carries a valid refresh cookie that would authenticate).
        var bodyOnlyClient = factory.CreateClient();
        var bannedRefresh = await bodyOnlyClient.PostAsJsonAsync("/api/auth/refresh",
            new { refresh_token = banned.RefreshToken });
        bannedRefresh.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
            "a banned user's refresh token must not be rotatable into new tokens");

        // Fail closed: the rejected rotation revoked every session, so even a retry stays rejected
        // (the token was not silently left active).
        var retryRefresh = await bodyOnlyClient.PostAsJsonAsync("/api/auth/refresh",
            new { refresh_token = banned.RefreshToken });
        retryRefresh.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    private async Task<AuthResponse> RegisterAsync(HttpClient client, string label)
    {
        var email = $"{label}-{Guid.NewGuid():N}@example.com";
        var response = await client.PostAsJsonAsync("/api/auth/register", new
        {
            email,
            password = "Password123!",
            display_name = label
        });
        response.EnsureSuccessStatusCode();
        var auth = await response.Content.ReadFromJsonAsync<AuthResponse>();
        auth.Should().NotBeNull();
        return auth! with { Email = email };
    }

    private static void UseBearer(HttpClient client, string accessToken) =>
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

    private async Task<RoomDto> GetRoomAsync(HttpClient client, string slug)
    {
        var room = await client.GetFromJsonAsync<RoomDto>($"/api/rooms/{slug}");
        room.Should().NotBeNull();
        return room!;
    }

    private async Task WithServicesAsync(Func<IServiceProvider, Task> action)
    {
        using var scope = factory.Services.CreateScope();
        await action(scope.ServiceProvider);
    }

    private sealed record AuthResponse(
        [property: JsonPropertyName("access_token")] string AccessToken,
        [property: JsonPropertyName("refresh_token")] string RefreshToken,
        [property: JsonPropertyName("user")] UserDto User)
    {
        public string Email { get; init; } = User.Email ?? "";
    }

    private sealed record RoomDto(
        [property: JsonPropertyName("id")] Guid Id,
        [property: JsonPropertyName("slug")] string Slug,
        [property: JsonPropertyName("name")] string Name,
        [property: JsonPropertyName("description")] string? Description);

    private sealed record UserDto(
        [property: JsonPropertyName("id")] Guid Id,
        [property: JsonPropertyName("email")] string? Email,
        [property: JsonPropertyName("username")] string? Username,
        [property: JsonPropertyName("display_name")] string? DisplayName,
        [property: JsonPropertyName("avatar_url")] string? AvatarUrl,
        [property: JsonPropertyName("roles")] string[] Roles,
        [property: JsonPropertyName("is_banned")] bool IsBanned);

    private sealed record MessageDto(
        [property: JsonPropertyName("id")] Guid Id,
        [property: JsonPropertyName("room_id")] Guid RoomId,
        [property: JsonPropertyName("author_id")] Guid AuthorId,
        [property: JsonPropertyName("body")] string Body);
}
