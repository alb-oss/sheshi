using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using FluentAssertions;
using Microsoft.AspNetCore.SignalR.Client;

namespace Sheshi.Api.Tests;

// Dedicated fixture so the coalescer's per-message timers / PresenceTracker can't be contaminated by
// other realtime tests.
public class VoteCoalesceTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Rapid_votes_on_one_message_coalesce_to_fewer_broadcasts_with_an_exact_final_score()
    {
        var client = factory.CreateClient();
        var author = await RegisterAsync(client, "coalesce-author");
        var room = await GetRoomAsync(client, "sheshi");

        UseBearer(client, author.AccessToken);
        var post = await (await client.PostAsJsonAsync("/api/messages",
            new { room_id = room.Id, body = "coalesce target" })).Content.ReadFromJsonAsync<MessageDto>();
        post.Should().NotBeNull();

        var received = new List<int>();
        await using var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(client.BaseAddress!, "/hub"),
                o => o.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler())
            .Build();
        connection.On<VoteEvent>("vote_changed", e =>
        {
            if (e.MessageId == post!.Id)
                lock (received) received.Add(e.Score);
        });
        await connection.StartAsync();
        await connection.InvokeAsync("JoinRoom", room.Id);

        // Five distinct users upvote the SAME post at once → a single ~250ms coalescing window.
        const int voters = 5;
        var tokens = new List<string>();
        for (var i = 0; i < voters; i++)
            tokens.Add((await RegisterAsync(factory.CreateClient(), $"coalesce-voter-{i}")).AccessToken);
        await Task.WhenAll(tokens.Select(token =>
        {
            var voterClient = factory.CreateClient();
            UseBearer(voterClient, token);
            return voterClient.PutAsJsonAsync($"/api/messages/{post!.Id}/vote", new { value = 1 });
        }));

        // Wait past the 250ms trailing-flush interval (plus margin).
        await Task.Delay(900);

        int count, last;
        lock (received)
        {
            count = received.Count;
            last = received.Count > 0 ? received[^1] : -1;
        }

        count.Should().BeInRange(1, voters - 1, "the burst must collapse to fewer broadcasts than votes");
        last.Should().Be(voters,
            "the trailing flush re-reads the DB, so the final broadcast score is exact (all 5 upvotes)");
    }

    private sealed record VoteEvent(
        [property: JsonPropertyName("message_id")] Guid MessageId,
        [property: JsonPropertyName("score")] int Score);

    private static void UseBearer(HttpClient client, string accessToken) =>
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

    private static async Task<AuthResponse> RegisterAsync(HttpClient client, string label)
    {
        var email = $"{label}-{Guid.NewGuid():N}@example.com";
        var response = await client.PostAsJsonAsync("/api/auth/register",
            new { email, password = "Password123!", display_name = label });
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
        [property: JsonPropertyName("access_token")] string AccessToken);

    private sealed record RoomDto([property: JsonPropertyName("id")] Guid Id);

    private sealed record MessageDto([property: JsonPropertyName("id")] Guid Id);
}
