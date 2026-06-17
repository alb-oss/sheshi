using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using FluentAssertions;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Tests;

// Regression for FINDING 3: moderators could ban/unban admins (and themselves), because Ban/Unban
// loaded the target and mutated it without checking the acting user's role against the target's.
// Hierarchy enforced (fail-closed): no self-ban; privileged targets (admin OR moderator) may only
// be acted on by an admin; regular-user bans by moderators stay allowed.
public class ModerationBanHierarchyTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Moderator_bans_regular_user_succeeds_but_cannot_touch_privileged_or_self()
    {
        var client = factory.CreateClient();
        var regular = await RegisterAsync(client, "hier-regular");
        var otherMod = await RegisterAsync(client, "hier-othermod");
        var someAdmin = await RegisterAsync(client, "hier-someadmin");
        var moderator = await RegisterAsync(client, "hier-mod");

        await WithServicesAsync(async sp =>
        {
            var userManager = sp.GetRequiredService<UserManager<ApplicationUser>>();
            await userManager.AddToRoleAsync((await userManager.FindByEmailAsync(otherMod.Email))!, Roles.Moderator);
            await userManager.AddToRoleAsync((await userManager.FindByEmailAsync(someAdmin.Email))!, Roles.Admin);
            await userManager.AddToRoleAsync((await userManager.FindByEmailAsync(moderator.Email))!, Roles.Moderator);
        });
        moderator = await LoginAsync(client, moderator.Email);

        UseBearer(client, moderator.AccessToken);

        // Moderator bans a regular user -> 204.
        (await client.PostAsync($"/api/mod/users/{regular.User.Id}/ban", content: null))
            .StatusCode.Should().Be(HttpStatusCode.NoContent);

        // Moderator bans an admin -> 403.
        (await client.PostAsync($"/api/mod/users/{someAdmin.User.Id}/ban", content: null))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);

        // Moderator bans another moderator -> 403.
        (await client.PostAsync($"/api/mod/users/{otherMod.User.Id}/ban", content: null))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);

        // Moderator cannot ban themselves -> 403.
        (await client.PostAsync($"/api/mod/users/{moderator.User.Id}/ban", content: null))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);

        // Privileged targets stay unbanned; the fail-closed checks ran BEFORE any mutation.
        await WithServicesAsync(async sp =>
        {
            var userManager = sp.GetRequiredService<UserManager<ApplicationUser>>();
            (await userManager.FindByEmailAsync(someAdmin.Email))!.IsBanned.Should().BeFalse();
            (await userManager.FindByEmailAsync(otherMod.Email))!.IsBanned.Should().BeFalse();
            (await userManager.FindByEmailAsync(moderator.Email))!.IsBanned.Should().BeFalse();
        });
    }

    [Fact]
    public async Task Admin_bans_moderator_succeeds_but_cannot_ban_self()
    {
        var client = factory.CreateClient();
        var moderator = await RegisterAsync(client, "hier-admin-target-mod");
        var admin = await RegisterAsync(client, "hier-admin");

        await WithServicesAsync(async sp =>
        {
            var userManager = sp.GetRequiredService<UserManager<ApplicationUser>>();
            await userManager.AddToRoleAsync((await userManager.FindByEmailAsync(moderator.Email))!, Roles.Moderator);
            await userManager.AddToRoleAsync((await userManager.FindByEmailAsync(admin.Email))!, Roles.Admin);
        });
        admin = await LoginAsync(client, admin.Email);

        UseBearer(client, admin.AccessToken);

        // Admin bans a moderator -> 204 (privileged action stays allowed).
        (await client.PostAsync($"/api/mod/users/{moderator.User.Id}/ban", content: null))
            .StatusCode.Should().Be(HttpStatusCode.NoContent);

        // Admin cannot ban themselves -> 403 (no self-ban, even for admins).
        (await client.PostAsync($"/api/mod/users/{admin.User.Id}/ban", content: null))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);

        await WithServicesAsync(async sp =>
        {
            var userManager = sp.GetRequiredService<UserManager<ApplicationUser>>();
            (await userManager.FindByEmailAsync(moderator.Email))!.IsBanned.Should().BeTrue();
            (await userManager.FindByEmailAsync(admin.Email))!.IsBanned.Should().BeFalse();
        });
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

    private async Task<AuthResponse> LoginAsync(HttpClient client, string email)
    {
        var response = await client.PostAsJsonAsync("/api/auth/login", new
        {
            email,
            password = "Password123!"
        });
        response.EnsureSuccessStatusCode();
        var auth = await response.Content.ReadFromJsonAsync<AuthResponse>();
        auth.Should().NotBeNull();
        return auth! with { Email = email };
    }

    private static void UseBearer(HttpClient client, string accessToken) =>
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

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

    private sealed record UserDto(
        [property: JsonPropertyName("id")] Guid Id,
        [property: JsonPropertyName("email")] string? Email,
        [property: JsonPropertyName("username")] string? Username,
        [property: JsonPropertyName("display_name")] string? DisplayName,
        [property: JsonPropertyName("avatar_url")] string? AvatarUrl,
        [property: JsonPropertyName("roles")] string[] Roles,
        [property: JsonPropertyName("is_banned")] bool IsBanned);
}
