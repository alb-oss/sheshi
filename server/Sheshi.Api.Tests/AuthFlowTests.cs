using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Sheshi.Api.Email;

namespace Sheshi.Api.Tests;

public class AuthFlowTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Register_login_refresh_logout_and_profile_flow_work()
    {
        var client = factory.CreateClient();
        var email = $"auth-{Guid.NewGuid():N}@example.com";

        var registerResponse = await client.PostAsJsonAsync("/api/auth/register", new
        {
            email,
            password = "Password123!",
            display_name = "Ada"
        });
        registerResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var registered = await registerResponse.Content.ReadFromJsonAsync<AuthResponse>();
        registered.Should().NotBeNull();
        registered!.AccessToken.Should().NotBeNullOrWhiteSpace();
        registered.RefreshToken.Should().NotBeNullOrWhiteSpace();
        registered.User.Email.Should().Be(email);
        registered.User.DisplayName.Should().Be("Ada");
        registered.User.Roles.Should().Contain("user");

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", registered.AccessToken);

        var meResponse = await client.GetAsync("/api/me");
        meResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var me = await meResponse.Content.ReadFromJsonAsync<UserDto>();
        me.Should().NotBeNull();
        me!.Email.Should().Be(email);

        var patchResponse = await client.PatchAsJsonAsync("/api/me", new { display_name = "Ada Lovelace" });
        patchResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var patched = await patchResponse.Content.ReadFromJsonAsync<UserDto>();
        patched.Should().NotBeNull();
        patched!.DisplayName.Should().Be("Ada Lovelace");

        var loginResponse = await client.PostAsJsonAsync("/api/auth/login", new
        {
            email,
            password = "Password123!"
        });
        loginResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var loggedIn = await loginResponse.Content.ReadFromJsonAsync<AuthResponse>();
        loggedIn.Should().NotBeNull();
        loggedIn!.User.DisplayName.Should().Be("Ada Lovelace");

        var refreshResponse = await client.PostAsJsonAsync("/api/auth/refresh", new
        {
            refresh_token = loggedIn.RefreshToken
        });
        refreshResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var refreshed = await refreshResponse.Content.ReadFromJsonAsync<AuthResponse>();
        refreshed.Should().NotBeNull();
        refreshed!.RefreshToken.Should().NotBe(loggedIn.RefreshToken);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", refreshed.AccessToken);
        var logoutResponse = await client.PostAsJsonAsync("/api/auth/logout", new
        {
            refresh_token = refreshed.RefreshToken
        });
        logoutResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var revokedRefreshResponse = await client.PostAsJsonAsync("/api/auth/refresh", new
        {
            refresh_token = refreshed.RefreshToken
        });
        revokedRefreshResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Login_rejects_wrong_password()
    {
        var client = factory.CreateClient();
        var email = $"wrong-password-{Guid.NewGuid():N}@example.com";

        var registerResponse = await client.PostAsJsonAsync("/api/auth/register", new
        {
            email,
            password = "Password123!",
            display_name = "Wrong Password"
        });
        registerResponse.EnsureSuccessStatusCode();

        var loginResponse = await client.PostAsJsonAsync("/api/auth/login", new
        {
            email,
            password = "NotThePassword123!"
        });

        loginResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Providers_endpoint_returns_only_configured_oauth_providers()
    {
        var client = factory.CreateClient();

        var response = await client.GetAsync("/api/auth/providers");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var providers = await response.Content.ReadFromJsonAsync<string[]>();
        providers.Should().NotBeNull();
        providers.Should().BeEmpty();
    }

    [Fact]
    public async Task Forgot_and_reset_password_flow_updates_the_password()
    {
        var sender = new CapturingEmailSender();
        var client = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IEmailSender>();
                services.AddSingleton<IEmailSender>(sender);
            });
        }).CreateClient();
        var email = $"reset-{Guid.NewGuid():N}@example.com";

        var registerResponse = await client.PostAsJsonAsync("/api/auth/register", new
        {
            email,
            password = "Password123!",
            display_name = "Reset User"
        });
        registerResponse.EnsureSuccessStatusCode();

        var forgotUnknownResponse = await client.PostAsJsonAsync("/api/auth/forgot-password", new
        {
            email = $"missing-{Guid.NewGuid():N}@example.com"
        });
        forgotUnknownResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        sender.ResetUrls.Should().BeEmpty();

        var forgotResponse = await client.PostAsJsonAsync("/api/auth/forgot-password", new { email });
        forgotResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        sender.ResetUrls.Should().ContainSingle();

        var resetUri = new Uri(sender.ResetUrls.Single());
        var query = QueryHelpers.ParseQuery(resetUri.Query);
        var token = query["token"].Single();
        query["email"].Single().Should().Be(email);

        var resetResponse = await client.PostAsJsonAsync("/api/auth/reset-password", new
        {
            email,
            token,
            password = "NewPassword123!"
        });
        resetResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var oldLoginResponse = await client.PostAsJsonAsync("/api/auth/login", new
        {
            email,
            password = "Password123!"
        });
        oldLoginResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        var newLoginResponse = await client.PostAsJsonAsync("/api/auth/login", new
        {
            email,
            password = "NewPassword123!"
        });
        newLoginResponse.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    private sealed record AuthResponse(
        [property: JsonPropertyName("access_token")] string AccessToken,
        [property: JsonPropertyName("refresh_token")] string RefreshToken,
        [property: JsonPropertyName("user")] UserDto User);

    private sealed record UserDto(
        [property: JsonPropertyName("id")] Guid Id,
        [property: JsonPropertyName("email")] string? Email,
        [property: JsonPropertyName("username")] string? Username,
        [property: JsonPropertyName("display_name")] string? DisplayName,
        [property: JsonPropertyName("avatar_url")] string? AvatarUrl,
        [property: JsonPropertyName("roles")] string[] Roles,
        [property: JsonPropertyName("is_banned")] bool IsBanned);

    private sealed class CapturingEmailSender : IEmailSender
    {
        public List<string> ResetUrls { get; } = [];

        public Task SendPasswordResetAsync(string email, string resetUrl, CancellationToken ct = default)
        {
            ResetUrls.Add(resetUrl);
            return Task.CompletedTask;
        }
    }
}
