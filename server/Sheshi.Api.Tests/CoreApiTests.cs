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
        rooms.Should().ContainSingle();
        rooms!.Single().Slug.Should().Be("sheshi");

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
        var alice = await PromoteToAdminAsync(client, await RegisterAsync(client, "alice"));
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
        var voteResponse = await client.PutAsync($"/api/messages/{main.Id}/vote", content: null);
        voteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);
        var secondVoteResponse = await client.PutAsync($"/api/messages/{main.Id}/vote", content: null);
        secondVoteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var replyVoteResponse = await client.PutAsync($"/api/messages/{reply.Id}/vote", content: null);
        replyVoteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var nestedReplyVoteResponse = await client.PutAsync($"/api/messages/{nestedReply.Id}/vote", content: null);
        nestedReplyVoteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var messagesResponse = await client.GetAsync($"/api/rooms/{room.Id}/messages");
        messagesResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var messagesPage = await messagesResponse.Content.ReadFromJsonAsync<CursorPageDto<MessageDto>>();
        var messages = messagesPage!.Items;
        messages.Should().NotBeNull();
        messages.Should().ContainSingle(m =>
            m.Id == main.Id &&
            m.Upvotes == 1 &&
            m.ReplyCount == 1 &&
            m.Voted);

        var repliesResponse = await client.GetAsync($"/api/messages/{main.Id}/replies");
        repliesResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var repliesPage = await repliesResponse.Content.ReadFromJsonAsync<CursorPageDto<MessageDto>>();
        var replies = repliesPage!.Items;
        replies.Should().NotBeNull();
        replies.Should().ContainSingle(r => r.Id == reply.Id && r.Upvotes == 1 && r.ReplyCount == 1 && r.Voted);

        var threadResponse = await client.GetAsync($"/api/threads/{main.Id}");
        threadResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var thread = await threadResponse.Content.ReadFromJsonAsync<ThreadDto>();
        thread.Should().NotBeNull();
        thread!.Root.Id.Should().Be(main.Id);
        thread.Replies.Should().ContainSingle();
        thread.Replies.Single().Message.Id.Should().Be(reply.Id);
        thread.Replies.Single().Replies.Should().ContainSingle();
        thread.Replies.Single().Replies.Single().Message.Id.Should().Be(nestedReply.Id);
        thread.Replies.Single().Replies.Single().Message.Upvotes.Should().Be(1);
        thread.Replies.Single().Replies.Single().Message.Voted.Should().BeTrue();

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
    public async Task Threads_store_root_depth_and_feeds_page_by_cursor()
    {
        var client = factory.CreateClient();
        var user = await PromoteToAdminAsync(client, await RegisterAsync(client, "thread-meta"));
        var room = await GetRoomAsync(client, "sheshi");
        UseBearer(client, user.AccessToken);

        var firstPost = await PostMessageAsync(client, room.Id, "First thread");
        await Task.Delay(5);
        var secondPost = await PostMessageAsync(client, room.Id, "Second thread");
        var firstReply = await PostMessageAsync(client, room.Id, "First reply", firstPost.Id);
        var nestedReply = await PostMessageAsync(client, room.Id, "Nested reply", firstReply.Id);

        await WithServicesAsync(async sp =>
        {
            var db = sp.GetRequiredService<AppDbContext>();
            var stored = await db.Messages
                .AsNoTracking()
                .Where(m => new[] { firstPost.Id, firstReply.Id, nestedReply.Id }.Contains(m.Id))
                .ToDictionaryAsync(m => m.Id);

            stored[firstPost.Id].RootMessageId.Should().Be(firstPost.Id);
            stored[firstPost.Id].Depth.Should().Be(0);
            stored[firstReply.Id].RootMessageId.Should().Be(firstPost.Id);
            stored[firstReply.Id].Depth.Should().Be(1);
            stored[nestedReply.Id].RootMessageId.Should().Be(firstPost.Id);
            stored[nestedReply.Id].Depth.Should().Be(2);
        });

        var firstPageResponse = await client.GetAsync($"/api/rooms/{room.Id}/messages?limit=1");
        firstPageResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var firstPage = await firstPageResponse.Content.ReadFromJsonAsync<CursorPageDto<MessageDto>>();
        firstPage.Should().NotBeNull();
        firstPage!.Items.Should().ContainSingle(m => m.Id == secondPost.Id);
        firstPage.NextCursor.Should().NotBeNullOrWhiteSpace();

        var secondPageResponse = await client.GetAsync($"/api/rooms/{room.Id}/messages?limit=1&cursor={Uri.EscapeDataString(firstPage.NextCursor!)}");
        secondPageResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var secondPage = await secondPageResponse.Content.ReadFromJsonAsync<CursorPageDto<MessageDto>>();
        secondPage.Should().NotBeNull();
        secondPage!.Items.Should().ContainSingle(m => m.Id == firstPost.Id);
    }

    [Fact]
    public async Task Message_authorization_rules_match_supabase_rls_port()
    {
        var client = factory.CreateClient();
        var author = await PromoteToAdminAsync(client, await RegisterAsync(client, "author"));
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

        // Non-admins cannot open threads but can still reply.
        UseBearer(client, other.AccessToken);
        var otherThreadResponse = await client.PostAsJsonAsync("/api/messages", new
        {
            room_id = room.Id,
            body = "Non-admin thread"
        });
        otherThreadResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var otherReplyResponse = await client.PostAsJsonAsync("/api/messages", new
        {
            room_id = room.Id,
            parent_id = main!.Id,
            body = "Non-admin reply"
        });
        otherReplyResponse.StatusCode.Should().Be(HttpStatusCode.Created);

        UseBearer(client, banned.AccessToken);
        var bannedPostResponse = await client.PostAsJsonAsync("/api/messages", new
        {
            room_id = room.Id,
            body = "I should be blocked"
        });
        bannedPostResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var bannedVoteResponse = await client.PutAsync($"/api/messages/{main!.Id}/vote", content: null);
        bannedVoteResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var bannedLoginResponse = await client.PostAsJsonAsync("/api/auth/login", new
        {
            email = banned.Email,
            password = "Password123!"
        });
        bannedLoginResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var bannedRefreshResponse = await client.PostAsJsonAsync("/api/auth/refresh", new
        {
            refresh_token = banned.RefreshToken
        });
        bannedRefreshResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        UseBearer(client, other.AccessToken);
        var otherDeleteResponse = await client.DeleteAsync($"/api/messages/{main.Id}");
        otherDeleteResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        UseBearer(client, moderator.AccessToken);
        var moderatorDeleteResponse = await client.DeleteAsync($"/api/messages/{main.Id}");
        moderatorDeleteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var deleted = await client.GetFromJsonAsync<MessageDto>($"/api/messages/{main.Id}");
        deleted.Should().NotBeNull();
        deleted!.DeletedAt.Should().NotBeNull();
        deleted.Body.Should().BeEmpty();
        deleted.ImageUrl.Should().BeNull();
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

    private async Task<AuthResponse> PromoteToAdminAsync(HttpClient client, AuthResponse auth)
    {
        await WithServicesAsync(async sp =>
        {
            var userManager = sp.GetRequiredService<UserManager<ApplicationUser>>();
            await userManager.AddToRoleAsync((await userManager.FindByEmailAsync(auth.Email))!, Roles.Admin);
        });
        return await LoginAsync(client, auth.Email);
    }

    private static void UseBearer(HttpClient client, string accessToken) =>
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

    private async Task<RoomDto> GetRoomAsync(HttpClient client, string slug)
    {
        var room = await client.GetFromJsonAsync<RoomDto>($"/api/rooms/{slug}");
        room.Should().NotBeNull();
        return room!;
    }

    private static async Task<MessageDto> PostMessageAsync(HttpClient client, Guid roomId, string body, Guid? parentId = null)
    {
        var response = await client.PostAsJsonAsync("/api/messages", new
        {
            room_id = roomId,
            parent_id = parentId,
            body
        });
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var message = await response.Content.ReadFromJsonAsync<MessageDto>();
        message.Should().NotBeNull();
        return message!;
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
