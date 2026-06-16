using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Configuration;
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
    public async Task Login_locks_account_after_repeated_bad_passwords()
    {
        var client = clientWithLowAuthLockout();
        var email = $"lockout-{Guid.NewGuid():N}@example.com";

        var registerResponse = await client.PostAsJsonAsync("/api/auth/register", new
        {
            email,
            password = "Password123!",
            display_name = "Lockout User"
        });
        registerResponse.EnsureSuccessStatusCode();

        for (var i = 0; i < 3; i++)
        {
            var badLogin = await client.PostAsJsonAsync("/api/auth/login", new
            {
                email,
                password = "WrongPassword123!"
            });
            badLogin.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        var lockedLogin = await client.PostAsJsonAsync("/api/auth/login", new
        {
            email,
            password = "Password123!"
        });
        lockedLogin.StatusCode.Should().Be(HttpStatusCode.Locked);

        HttpClient clientWithLowAuthLockout() => factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Auth:Lockout:MaxFailedAccessAttempts"] = "3",
                    ["Auth:Lockout:Minutes"] = "15"
                });
            });
        }).CreateClient();
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
        var registered = await registerResponse.Content.ReadFromJsonAsync<AuthResponse>();
        registered.Should().NotBeNull();

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

        // Use a fresh (cookie-free) client so ONLY the body token is presented — the new login above
        // left a valid refresh cookie on `client`, which would correctly authenticate a refresh. This
        // asserts the register-time token was revoked by the password reset.
        var bodyOnlyClient = factory.CreateClient();
        var revokedRefreshResponse = await bodyOnlyClient.PostAsJsonAsync("/api/auth/refresh", new
        {
            refresh_token = registered!.RefreshToken
        });
        revokedRefreshResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Refresh_and_logout_work_via_the_httponly_cookie_with_no_body_token()
    {
        // The WebApplicationFactory client keeps a cookie container, so the sheshi_rt cookie set on
        // login persists and authenticates refresh/logout with NO token in the body — the browser path.
        var client = factory.CreateClient();
        var email = $"cookie-{Guid.NewGuid():N}@example.com";

        (await client.PostAsJsonAsync("/api/auth/register",
            new { email, password = "Password123!", display_name = "Cookie" })).EnsureSuccessStatusCode();

        var login = await client.PostAsJsonAsync("/api/auth/login", new { email, password = "Password123!" });
        login.EnsureSuccessStatusCode();
        var setCookie = login.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith("sheshi_rt="));
        var lower = setCookie.ToLowerInvariant();
        lower.Should().Contain("httponly", "the refresh cookie must be unreadable by JS");
        lower.Should().Contain("path=/api/auth", "the cookie is scoped to the auth endpoints only");
        lower.Should().Contain("samesite=lax");

        var loggedIn = await login.Content.ReadFromJsonAsync<AuthResponse>();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", loggedIn!.AccessToken);

        // Refresh with an empty body — the cookie alone must authenticate it.
        var refresh = await client.PostAsJsonAsync("/api/auth/refresh", new { });
        refresh.StatusCode.Should().Be(HttpStatusCode.OK);

        // Logout with an empty body clears the cookie (Set-Cookie with a past expiry).
        var logout = await client.PostAsJsonAsync("/api/auth/logout", new { });
        logout.StatusCode.Should().Be(HttpStatusCode.NoContent);

        // Cookie gone (and the token revoked) → a cookie-only refresh is now rejected.
        var afterLogout = await client.PostAsJsonAsync("/api/auth/refresh", new { });
        afterLogout.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
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
