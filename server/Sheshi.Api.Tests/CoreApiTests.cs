using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using FluentAssertions;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Tests;

public class CoreApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Rooms_endpoints_return_seeded_rooms()
    {
        var client = factory.CreateClient();

        var roomsResponse = await client.GetAsync("/api/rooms");
        roomsResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var rooms = await roomsResponse.Content.ReadFromJsonAsync<RoomDto[]>();
        rooms.Should().NotBeNull();
        rooms.Should().HaveCount(5);
        rooms!.Select(r => r.Slug).Should().Contain(["sheshi", "vjosa-narta", "tirana", "shkodra", "korca"]);

        var sheshiResponse = await client.GetAsync("/api/rooms/sheshi");
        sheshiResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var sheshi = await sheshiResponse.Content.ReadFromJsonAsync<RoomDto>();
        sheshi.Should().NotBeNull();
        sheshi!.Name.Should().Be("#sheshi");

        var missingResponse = await client.GetAsync("/api/rooms/missing-room");
        missingResponse.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Message_vote_report_and_highlight_flow_matches_current_app_contract()
    {
        var client = factory.CreateClient();
        var alice = await RegisterAsync(client, "alice");
        var bob = await RegisterAsync(client, "bob");
        var room = await GetRoomAsync(client, "sheshi");

        UseBearer(client, alice.AccessToken);
        var postResponse = await client.PostAsJsonAsync("/api/messages", new
        {
            room_id = room.Id,
            body = "Main message"
        });
        postResponse.StatusCode.Should().Be(HttpStatusCode.Created);
        var main = await postResponse.Content.ReadFromJsonAsync<MessageDto>();
        main.Should().NotBeNull();
        main!.Body.Should().Be("Main message");
        main.ParentId.Should().BeNull();

        var replyResponse = await client.PostAsJsonAsync("/api/messages", new
        {
            room_id = room.Id,
            parent_id = main.Id,
            body = "@alice Reply"
        });
        replyResponse.StatusCode.Should().Be(HttpStatusCode.Created);
        var reply = await replyResponse.Content.ReadFromJsonAsync<MessageDto>();
        reply.Should().NotBeNull();
        reply!.ParentId.Should().Be(main.Id);

        UseBearer(client, bob.AccessToken);
        var voteResponse = await client.PutAsync($"/api/messages/{main.Id}/vote", content: null);
        voteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);
        var secondVoteResponse = await client.PutAsync($"/api/messages/{main.Id}/vote", content: null);
        secondVoteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var replyVoteResponse = await client.PutAsync($"/api/messages/{reply.Id}/vote", content: null);
        replyVoteResponse.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var messagesResponse = await client.GetAsync($"/api/rooms/{room.Id}/messages");
        messagesResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var messages = await messagesResponse.Content.ReadFromJsonAsync<MessageDto[]>();
        messages.Should().NotBeNull();
        messages.Should().ContainSingle(m =>
            m.Id == main.Id &&
            m.Upvotes == 1 &&
            m.ReplyCount == 1 &&
            m.Voted);

        var repliesResponse = await client.GetAsync($"/api/messages/{main.Id}/replies");
        repliesResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var replies = await repliesResponse.Content.ReadFromJsonAsync<MessageDto[]>();
        replies.Should().NotBeNull();
        replies.Should().ContainSingle(r => r.Id == reply.Id);

        var reportResponse = await client.PostAsJsonAsync($"/api/messages/{main.Id}/report", new
        {
            reason = "spam",
            note = "Needs a look"
        });
        reportResponse.StatusCode.Should().Be(HttpStatusCode.Created);

        var longReportResponse = await client.PostAsJsonAsync($"/api/messages/{main.Id}/report", new
        {
            reason = "other",
            note = new string('x', 501)
        });
        longReportResponse.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var highlightsResponse = await client.GetAsync("/api/highlights?mode=top");
        highlightsResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var highlights = await highlightsResponse.Content.ReadFromJsonAsync<MessageDto[]>();
        highlights.Should().NotBeNull();
        highlights.Should().ContainSingle(h => h.Id == main.Id && h.Upvotes == 1);
    }

    [Fact]
    public async Task Message_authorization_rules_match_supabase_rls_port()
    {
        var client = factory.CreateClient();
        var author = await RegisterAsync(client, "author");
        var other = await RegisterAsync(client, "other");
        var banned = await RegisterAsync(client, "banned");
        var moderator = await RegisterAsync(client, "moderator");
        var room = await GetRoomAsync(client, "sheshi");

        await WithServicesAsync(async sp =>
        {
            var userManager = sp.GetRequiredService<UserManager<ApplicationUser>>();
            var bannedUser = await userManager.FindByEmailAsync(banned.Email);
            bannedUser!.BannedAt = DateTimeOffset.UtcNow;
            await userManager.UpdateAsync(bannedUser);

            var moderatorUser = await userManager.FindByEmailAsync(moderator.Email);
            await userManager.AddToRoleAsync(moderatorUser!, Roles.Moderator);
        });

        UseBearer(client, author.AccessToken);
        var mainResponse = await client.PostAsJsonAsync("/api/messages", new
        {
            room_id = room.Id,
            body = "Owned by author"
        });
        mainResponse.StatusCode.Should().Be(HttpStatusCode.Created);
        var main = await mainResponse.Content.ReadFromJsonAsync<MessageDto>();
        main.Should().NotBeNull();

        UseBearer(client, banned.AccessToken);
        var bannedPostResponse = await client.PostAsJsonAsync("/api/messages", new
        {
            room_id = room.Id,
            body = "I should be blocked"
        });
        bannedPostResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var bannedVoteResponse = await client.PutAsync($"/api/messages/{main!.Id}/vote", content: null);
        bannedVoteResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        UseBearer(client, other.AccessToken);
        var otherDeleteResponse = await client.DeleteAsync($"/api/messages/{main.Id}");
        otherDeleteResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        UseBearer(client, moderator.AccessToken);
        var moderatorDeleteResponse = await client.DeleteAsync($"/api/messages/{main.Id}");
        moderatorDeleteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var deleted = await client.GetFromJsonAsync<MessageDto>($"/api/messages/{main.Id}");
        deleted.Should().NotBeNull();
        deleted!.DeletedAt.Should().NotBeNull();
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

    private sealed record AuthorDto(
        [property: JsonPropertyName("id")] Guid Id,
        [property: JsonPropertyName("username")] string? Username,
        [property: JsonPropertyName("display_name")] string? DisplayName,
        [property: JsonPropertyName("avatar_url")] string? AvatarUrl);

    private sealed record MessageDto(
        [property: JsonPropertyName("id")] Guid Id,
        [property: JsonPropertyName("room_id")] Guid RoomId,
        [property: JsonPropertyName("author_id")] Guid AuthorId,
        [property: JsonPropertyName("parent_id")] Guid? ParentId,
        [property: JsonPropertyName("body")] string Body,
        [property: JsonPropertyName("image_url")] string? ImageUrl,
        [property: JsonPropertyName("deleted_at")] DateTimeOffset? DeletedAt,
        [property: JsonPropertyName("created_at")] DateTimeOffset CreatedAt,
        [property: JsonPropertyName("author")] AuthorDto? Author,
        [property: JsonPropertyName("upvotes")] int Upvotes,
        [property: JsonPropertyName("reply_count")] int ReplyCount,
        [property: JsonPropertyName("voted")] bool Voted);
}
