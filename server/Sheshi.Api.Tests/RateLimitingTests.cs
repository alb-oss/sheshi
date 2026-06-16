using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace Sheshi.Api.Tests;

public class RateLimitingTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Message_write_rate_limit_blocks_user_burst()
    {
        var client = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["RateLimits:Writes:PermitLimit"] = "2",
                    ["RateLimits:Writes:WindowSeconds"] = "60",
                    ["RateLimits:Auth:PermitLimit"] = "100"
                });
            });
        }).CreateClient();
        var user = await RegisterAsync(client, "limited");
        var room = await GetRoomAsync(client, "sheshi");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", user.AccessToken);

        var first = await PostMessageAsync(client, room.Id, "burst one");
        var second = await PostMessageAsync(client, room.Id, "burst two");
        var third = await client.PostAsJsonAsync("/api/messages", new
        {
            room_id = room.Id,
            body = "burst three"
        });

        first.StatusCode.Should().Be(HttpStatusCode.Created);
        second.StatusCode.Should().Be(HttpStatusCode.Created);
        third.StatusCode.Should().Be((HttpStatusCode)429);
        third.Headers.RetryAfter.Should().NotBeNull();
    }

    private static Task<HttpResponseMessage> PostMessageAsync(HttpClient client, Guid roomId, string body) =>
        client.PostAsJsonAsync("/api/messages", new
        {
            room_id = roomId,
            body
        });

    [Fact]
    public async Task Auth_per_email_limiter_trips_for_one_account_across_requests()
    {
        // Per-account limit of 2; the IP limit is raised out of the way so the per-email bucket is the
        // binding constraint. A 3rd login for the SAME email must be 429 even though the IP budget is fine.
        var client = factory.WithWebHostBuilder(builder => builder.ConfigureAppConfiguration((_, config) =>
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["RateLimits:AuthAccount:PermitLimit"] = "2",
                ["RateLimits:Auth:PermitLimit"] = "100",
            }))).CreateClient();

        var email = $"peremail-{Guid.NewGuid():N}@example.com";
        (await client.PostAsJsonAsync("/api/auth/register",
            new { email, password = "Password123!", display_name = "pe" })).EnsureSuccessStatusCode();

        async Task<HttpStatusCode> Login() =>
            (await client.PostAsJsonAsync("/api/auth/login", new { email, password = "Password123!" })).StatusCode;

        (await Login()).Should().Be(HttpStatusCode.OK);
        (await Login()).Should().Be(HttpStatusCode.OK);
        (await Login()).Should().Be((HttpStatusCode)429,
            "the 3rd login for the same email exceeds the per-account limit regardless of IP");
    }

    [Fact]
    public async Task Auth_per_email_limiter_is_isolated_per_account()
    {
        var client = factory.WithWebHostBuilder(builder => builder.ConfigureAppConfiguration((_, config) =>
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["RateLimits:AuthAccount:PermitLimit"] = "2",
                ["RateLimits:Auth:PermitLimit"] = "100",
            }))).CreateClient();

        var emailA = $"pa-{Guid.NewGuid():N}@example.com";
        var emailB = $"pb-{Guid.NewGuid():N}@example.com";
        foreach (var e in new[] { emailA, emailB })
            (await client.PostAsJsonAsync("/api/auth/register",
                new { email = e, password = "Password123!", display_name = "p" })).EnsureSuccessStatusCode();

        // Exhaust A's per-account bucket (limit 2 → 3rd is 429).
        for (var i = 0; i < 3; i++)
            await client.PostAsJsonAsync("/api/auth/login", new { email = emailA, password = "Password123!" });

        // B is a separate partition and must still authenticate.
        (await client.PostAsJsonAsync("/api/auth/login", new { email = emailB, password = "Password123!" }))
            .StatusCode.Should().Be(HttpStatusCode.OK);
    }

    private static async Task<AuthResponse> RegisterAsync(HttpClient client, string label)
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
        return auth!;
    }

    private static async Task<RoomDto> GetRoomAsync(HttpClient client, string slug)
    {
        var room = await client.GetFromJsonAsync<RoomDto>($"/api/rooms/{slug}");
        room.Should().NotBeNull();
        return room!;
    }

    private sealed record AuthResponse(
        [property: JsonPropertyName("access_token")] string AccessToken,
        [property: JsonPropertyName("refresh_token")] string RefreshToken);

    private sealed record RoomDto(
        [property: JsonPropertyName("id")] Guid Id,
        [property: JsonPropertyName("slug")] string Slug);
}
