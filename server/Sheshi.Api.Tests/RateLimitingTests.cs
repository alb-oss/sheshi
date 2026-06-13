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
