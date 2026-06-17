using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Tests;

// Regression (FINDING 1, HIGH): a soft-deleted message used to keep serving its Body/ImageUrl/VideoUrl
// on every public read — the delete only set DeletedAt, and EnrichAsync copied the raw content straight
// through. The fix tombstones at the DTO boundary (the single EnrichAsync construction site every read
// path funnels through): DeletedAt != null ⇒ body = "", image_url = null, video_url = null, while the
// row, its deleted_at, score, reply_count, my_vote and thread structure are preserved (the "[deleted]"
// UI and counts are unchanged). These tests assert the masking across the single-message endpoint, the
// room feed AND the thread — including a deleted reply nested inside a live thread.
public class DeletedMessageMaskingTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Soft_deleted_message_is_tombstoned_on_single_message_room_feed_and_thread()
    {
        var client = factory.CreateClient();
        var author = await RegisterAsync(client, "tombstone-author");
        var room = await GetRoomAsync(client, "sheshi");

        UseBearer(client, author.AccessToken);

        // A root post WITH media seeded directly so image/video masking is also covered (the public
        // post API needs multipart to attach media; seeding the row is the established harness pattern).
        var rootId = Guid.NewGuid();
        await WithServicesAsync(async sp =>
        {
            var db = sp.GetRequiredService<AppDbContext>();
            db.Messages.Add(new Message
            {
                Id = rootId,
                RoomId = room.Id,
                AuthorId = author.User.Id,
                Body = "secret root body",
                ImageUrl = "http://localhost:5080/uploads/secret-image.png",
                VideoUrl = "http://localhost:5080/uploads/secret-video.mp4",
                CreatedAt = DateTimeOffset.UtcNow
            });
            await db.SaveChangesAsync();
        });

        // A live reply (so the thread keeps a real child) plus a reply we will delete.
        var liveReply = await CreateReplyAsync(client, room.Id, rootId, "live reply stays visible");
        var deletedReply = await CreateReplyAsync(client, room.Id, rootId, "secret reply body");

        // Soft-delete the root post and one reply (author deletes their own).
        (await client.DeleteAsync($"/api/messages/{rootId}")).StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await client.DeleteAsync($"/api/messages/{deletedReply.Id}")).StatusCode.Should().Be(HttpStatusCode.NoContent);

        // 1) Single-message endpoint — root is tombstoned: empty body, null media, but row + deleted_at intact.
        var single = await client.GetFromJsonAsync<MessageDto>($"/api/messages/{rootId}");
        single.Should().NotBeNull();
        single!.Id.Should().Be(rootId, "the row is still present, not removed");
        single.DeletedAt.Should().NotBeNull("deleted_at must remain set so the [deleted] UI renders");
        single.Body.Should().Be("", "a deleted message's body must be masked to an empty string");
        single.ImageUrl.Should().BeNull("a deleted message's image_url must be masked to null");
        single.VideoUrl.Should().BeNull("a deleted message's video_url must be masked to null");

        // 2) Room feed — the deleted root still appears (thread structure intact) but stays tombstoned,
        //    and its reply_count still counts both children (counts unchanged by the masking).
        var feed = await client.GetFromJsonAsync<CursorPageDto<MessageDto>>($"/api/rooms/{room.Id}/messages");
        feed.Should().NotBeNull();
        var feedRoot = feed!.Items.SingleOrDefault(m => m.Id == rootId);
        feedRoot.Should().NotBeNull("the deleted root must still be present in the feed (structure preserved)");
        feedRoot!.DeletedAt.Should().NotBeNull();
        feedRoot.Body.Should().Be("");
        feedRoot.ImageUrl.Should().BeNull();
        feedRoot.VideoUrl.Should().BeNull();
        feedRoot.ReplyCount.Should().Be(2, "deleted children are still counted — counts are not changed by masking");

        // 3) Thread — root tombstoned; the live reply still shows its body; the deleted reply is
        //    tombstoned in place (the node stays so the tree structure is unchanged).
        var thread = await client.GetFromJsonAsync<ThreadDto>($"/api/threads/{rootId}");
        thread.Should().NotBeNull();
        thread!.Root.Id.Should().Be(rootId);
        thread.Root.Body.Should().Be("");
        thread.Root.ImageUrl.Should().BeNull();
        thread.Root.VideoUrl.Should().BeNull();
        thread.Root.DeletedAt.Should().NotBeNull();

        thread.Replies.Should().HaveCount(2, "both replies remain in the tree, including the deleted one");

        var liveNode = thread.Replies.Single(r => r.Message.Id == liveReply.Id);
        liveNode.Message.Body.Should().Be("live reply stays visible", "a non-deleted reply is untouched");
        liveNode.Message.DeletedAt.Should().BeNull();

        var deletedNode = thread.Replies.Single(r => r.Message.Id == deletedReply.Id);
        deletedNode.Message.DeletedAt.Should().NotBeNull();
        deletedNode.Message.Body.Should().Be("", "a deleted reply inside a thread must be tombstoned too");
        deletedNode.Message.ImageUrl.Should().BeNull();
        deletedNode.Message.VideoUrl.Should().BeNull();
    }

    private async Task<MessageDto> CreateReplyAsync(HttpClient client, Guid roomId, Guid parentId, string body)
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
        return auth!;
    }

    private async Task<RoomDto> GetRoomAsync(HttpClient client, string slug)
    {
        var room = await client.GetFromJsonAsync<RoomDto>($"/api/rooms/{slug}");
        room.Should().NotBeNull();
        return room!;
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
        [property: JsonPropertyName("user")] UserDto User);

    private sealed record RoomDto(
        [property: JsonPropertyName("id")] Guid Id,
        [property: JsonPropertyName("slug")] string Slug,
        [property: JsonPropertyName("name")] string Name,
        [property: JsonPropertyName("description")] string? Description);

    private sealed record UserDto(
        [property: JsonPropertyName("id")] Guid Id,
        [property: JsonPropertyName("email")] string? Email,
        [property: JsonPropertyName("username")] string? Username,
        [property: JsonPropertyName("display_name")] string? DisplayName);

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
        [property: JsonPropertyName("video_url")] string? VideoUrl,
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
