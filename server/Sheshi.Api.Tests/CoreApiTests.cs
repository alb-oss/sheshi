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
        rooms.Should().Contain(r => r.Slug == "sheshi");

        var sheshiResponse = await client.GetAsync("/api/rooms/sheshi");
        sheshiResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var sheshi = await sheshiResponse.Content.ReadFromJsonAsync<RoomDto>();
        sheshi.Should().NotBeNull();
        sheshi!.Name.Should().Be("#sheshi");
        sheshi.Description.Should().Be("Diskutimi kryesor publik.");

        var missingResponse = await client.GetAsync("/api/rooms/missing-room");
        missingResponse.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Only_admins_can_create_rooms()
    {
        var client = factory.CreateClient();
        var normal = await RegisterAsync(client, "room-user");
        var admin = await RegisterAsync(client, "room-admin");
        await WithServicesAsync(async sp =>
        {
            var userManager = sp.GetRequiredService<UserManager<ApplicationUser>>();
            var adminUser = await userManager.FindByEmailAsync(admin.Email);
            await userManager.AddToRoleAsync(adminUser!, Roles.Admin);
        });
        admin = await LoginAsync(client, admin.Email);

        client.DefaultRequestHeaders.Authorization = null;
        var unauthenticatedResponse = await client.PostAsJsonAsync("/api/rooms", new
        {
            name = "Lagjja"
        });
        unauthenticatedResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        UseBearer(client, normal.AccessToken);
        var normalCreateResponse = await client.PostAsJsonAsync("/api/rooms", new
        {
            name = "Lagjja",
            description = "Diskutim lokal"
        });
        normalCreateResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        UseBearer(client, admin.AccessToken);
        var createResponse = await client.PostAsJsonAsync("/api/rooms", new
        {
            name = "Lagjja",
            description = "Diskutim lokal"
        });
        createResponse.StatusCode.Should().Be(HttpStatusCode.Created);
        var room = await createResponse.Content.ReadFromJsonAsync<RoomDto>();
        room.Should().NotBeNull();
        room!.Slug.Should().Be("lagjja");
        room.Name.Should().Be("#Lagjja");

        var duplicateResponse = await client.PostAsJsonAsync("/api/rooms", new
        {
            name = "Lagjja"
        });
        duplicateResponse.StatusCode.Should().Be(HttpStatusCode.Conflict);
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

        var nestedReplyResponse = await client.PostAsJsonAsync("/api/messages", new
        {
            room_id = room.Id,
            parent_id = reply.Id,
            body = "@alice Nested reply"
        });
        nestedReplyResponse.StatusCode.Should().Be(HttpStatusCode.Created);
        var nestedReply = await nestedReplyResponse.Content.ReadFromJsonAsync<MessageDto>();
        nestedReply.Should().NotBeNull();
        nestedReply!.ParentId.Should().Be(reply.Id);

        UseBearer(client, bob.AccessToken);
        var voteResponse = await client.PutAsJsonAsync($"/api/messages/{main.Id}/vote", new { value = 1 });
        voteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);
        var secondVoteResponse = await client.PutAsJsonAsync($"/api/messages/{main.Id}/vote", new { value = 1 });
        secondVoteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var replyVoteResponse = await client.PutAsJsonAsync($"/api/messages/{reply.Id}/vote", new { value = 1 });
        replyVoteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var nestedReplyVoteResponse = await client.PutAsJsonAsync($"/api/messages/{nestedReply.Id}/vote", new { value = 1 });
        nestedReplyVoteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var messagesResponse = await client.GetAsync($"/api/rooms/{room.Id}/messages");
        messagesResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var messages = await messagesResponse.Content.ReadFromJsonAsync<CursorPageDto<MessageDto>>();
        messages.Should().NotBeNull();
        messages!.NextCursor.Should().BeNull();
        // reply_count is the FULL subtree size: main has a direct reply AND a nested sub-reply,
        // so it counts 2 (not 1) — sub-replies are included.
        messages.Items.Should().ContainSingle(m =>
            m.Id == main.Id &&
            m.Score == 1 &&
            m.ReplyCount == 2 &&
            m.MyVote == 1);

        var repliesResponse = await client.GetAsync($"/api/messages/{main.Id}/replies");
        repliesResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var replies = await repliesResponse.Content.ReadFromJsonAsync<CursorPageDto<MessageDto>>();
        replies.Should().NotBeNull();
        replies!.NextCursor.Should().BeNull();
        replies.Items.Should().ContainSingle(r => r.Id == reply.Id && r.Score == 1 && r.ReplyCount == 1 && r.MyVote == 1);

        var threadResponse = await client.GetAsync($"/api/threads/{main.Id}");
        threadResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var thread = await threadResponse.Content.ReadFromJsonAsync<ThreadDto>();
        thread.Should().NotBeNull();
        thread!.Root.Id.Should().Be(main.Id);
        thread.Root.ReplyCount.Should().Be(2); // root counts the nested sub-reply too
        thread.Replies.Should().ContainSingle();
        thread.Replies.Single().Message.Id.Should().Be(reply.Id);
        thread.Replies.Single().Replies.Should().ContainSingle();
        thread.Replies.Single().Replies.Single().Message.Id.Should().Be(nestedReply.Id);
        thread.Replies.Single().Replies.Single().Message.Score.Should().Be(1);
        thread.Replies.Single().Replies.Single().Message.MyVote.Should().Be(1);

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
        highlights.Should().ContainSingle(h => h.Id == main.Id && h.Score == 1);

        // Reddit-style up/down: switching to a downvote nets the score, 0 clears it, and only
        // {-1,0,1} are accepted.
        (await client.PutAsJsonAsync($"/api/messages/{reply.Id}/vote", new { value = -1 }))
            .StatusCode.Should().Be(HttpStatusCode.NoContent);
        var afterDown = await (await client.GetAsync($"/api/messages/{main.Id}/replies"))
            .Content.ReadFromJsonAsync<CursorPageDto<MessageDto>>();
        afterDown!.Items.Should().ContainSingle(r => r.Id == reply.Id && r.Score == -1 && r.MyVote == -1);

        (await client.PutAsJsonAsync($"/api/messages/{reply.Id}/vote", new { value = 0 }))
            .StatusCode.Should().Be(HttpStatusCode.NoContent);
        var afterClear = await (await client.GetAsync($"/api/messages/{main.Id}/replies"))
            .Content.ReadFromJsonAsync<CursorPageDto<MessageDto>>();
        afterClear!.Items.Should().ContainSingle(r => r.Id == reply.Id && r.Score == 0 && r.MyVote == 0);

        (await client.PutAsJsonAsync($"/api/messages/{reply.Id}/vote", new { value = 2 }))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);
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
        var bannedVoteResponse = await client.PutAsJsonAsync($"/api/messages/{main!.Id}/vote", new { value = 1 });
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

    // Regression: a brand-new post with zero votes and zero replies must NOT top "hot" over an
    // engaged post — the old recency-dominated formula ranked empty newest posts first.
    [Fact]
    public async Task Hot_highlights_rank_engaged_posts_above_newer_empty_ones()
    {
        var client = factory.CreateClient();
        var author = await RegisterAsync(client, "hot-author");
        var voter = await RegisterAsync(client, "hot-voter");
        var room = await GetRoomAsync(client, "sheshi");

        UseBearer(client, author.AccessToken);
        var engaged = (await (await client.PostAsJsonAsync("/api/messages",
            new { room_id = room.Id, body = "engaged post" })).Content.ReadFromJsonAsync<MessageDto>())!;
        var empty = (await (await client.PostAsJsonAsync("/api/messages",
            new { room_id = room.Id, body = "brand new empty post" })).Content.ReadFromJsonAsync<MessageDto>())!;

        UseBearer(client, voter.AccessToken);
        (await client.PutAsJsonAsync($"/api/messages/{engaged.Id}/vote", new { value = 1 }))
            .StatusCode.Should().Be(HttpStatusCode.NoContent);

        var hot = await client.GetFromJsonAsync<MessageDto[]>("/api/highlights?mode=hot");
        hot.Should().NotBeNull();
        var ids = hot!.Select(h => h.Id).ToList();
        ids.Should().Contain(engaged.Id).And.Contain(empty.Id);
        ids.IndexOf(engaged.Id).Should().BeLessThan(ids.IndexOf(empty.Id),
            "an engaged post must outrank a newer zero-engagement post in hot");
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
        [property: JsonPropertyName("score")] int Score,
        [property: JsonPropertyName("reply_count")] int ReplyCount,
        [property: JsonPropertyName("my_vote")] int MyVote);

    private sealed record CursorPageDto<T>(
        [property: JsonPropertyName("items")] T[] Items,
        [property: JsonPropertyName("next_cursor")] string? NextCursor);

    private sealed record ThreadDto(
        [property: JsonPropertyName("root")] MessageDto Root,
        [property: JsonPropertyName("replies")] ReplyNodeDto[] Replies);

    private sealed record ReplyNodeDto(
        [property: JsonPropertyName("message")] MessageDto Message,
        [property: JsonPropertyName("replies")] ReplyNodeDto[] Replies,
        [property: JsonPropertyName("depth")] int Depth);
}
