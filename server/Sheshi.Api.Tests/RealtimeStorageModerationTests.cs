using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using FluentAssertions;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Tests;

public class RealtimeStorageModerationTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task SignalR_room_members_receive_changed_events_and_presence_counts_update()
    {
        var client = factory.CreateClient();
        var user = await RegisterAsync(client, "realtime");
        var room = await GetRoomAsync(client, "sheshi");
        var changed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        await using var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(client.BaseAddress!, "/hub"), options =>
            {
                options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
            })
            .Build();
        connection.On("changed", () => changed.TrySetResult());

        await connection.StartAsync();
        await connection.InvokeAsync("JoinRoom", room.Id);

        var presence = await client.GetFromJsonAsync<Dictionary<string, int>>("/api/rooms/presence");
        presence.Should().NotBeNull();
        presence!.Should().ContainKey(room.Id.ToString());
        presence[room.Id.ToString()].Should().Be(1);

        UseBearer(client, user.AccessToken);
        var postResponse = await client.PostAsJsonAsync("/api/messages", new
        {
            room_id = room.Id,
            body = "Realtime ping"
        });
        postResponse.StatusCode.Should().Be(HttpStatusCode.Created);

        await changed.Task.WaitAsync(TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task Multipart_message_post_saves_image_and_returns_image_url()
    {
        var client = factory.CreateClient();
        var user = await RegisterAsync(client, "image");
        var room = await GetRoomAsync(client, "sheshi");
        UseBearer(client, user.AccessToken);

        using var form = new MultipartFormDataContent();
        form.Add(new StringContent(room.Id.ToString()), "room_id");
        form.Add(new StringContent("Message with image"), "body");
        var image = new ByteArrayContent(Convert.FromBase64String(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="));
        image.Headers.ContentType = MediaTypeHeaderValue.Parse("image/png");
        form.Add(image, "image", "pixel.png");

        var response = await client.PostAsync("/api/messages", form);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var message = await response.Content.ReadFromJsonAsync<MessageDto>();
        message.Should().NotBeNull();
        message!.ImageUrl.Should().StartWith("http://localhost:5080/uploads/");
    }

    [Fact]
    public async Task Moderation_endpoints_enforce_roles_and_apply_actions()
    {
        var client = factory.CreateClient();
        var reporter = await RegisterAsync(client, "reporter");
        var normal = await RegisterAsync(client, "normal");
        var futureMod = await RegisterAsync(client, "futuremod");
        var moderator = await RegisterAsync(client, "mod");
        var admin = await RegisterAsync(client, "admin");
        var room = await GetRoomAsync(client, "sheshi");

        await WithServicesAsync(async sp =>
        {
            var userManager = sp.GetRequiredService<UserManager<ApplicationUser>>();
            await userManager.AddToRoleAsync((await userManager.FindByEmailAsync(moderator.Email))!, Roles.Moderator);
            await userManager.AddToRoleAsync((await userManager.FindByEmailAsync(admin.Email))!, Roles.Admin);
        });
        moderator = await LoginAsync(client, moderator.Email);
        admin = await LoginAsync(client, admin.Email);

        UseBearer(client, reporter.AccessToken);
        var postResponse = await client.PostAsJsonAsync("/api/messages", new
        {
            room_id = room.Id,
            body = "Needs moderation"
        });
        var message = await postResponse.Content.ReadFromJsonAsync<MessageDto>();
        message.Should().NotBeNull();
        var reportResponse = await client.PostAsJsonAsync($"/api/messages/{message!.Id}/report", new
        {
            reason = "hate",
            note = "bad"
        });
        reportResponse.StatusCode.Should().Be(HttpStatusCode.Created);

        UseBearer(client, normal.AccessToken);
        var normalReportsResponse = await client.GetAsync("/api/mod/reports");
        normalReportsResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        UseBearer(client, moderator.AccessToken);
        var reportsResponse = await client.GetAsync("/api/mod/reports?status=open");
        reportsResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var reports = await reportsResponse.Content.ReadFromJsonAsync<ModReportDto[]>();
        reports.Should().NotBeNull();
        reports.Should().ContainSingle(r => r.MessageId == message.Id && r.Status == "open");
        var reportId = reports!.Single(r => r.MessageId == message.Id).Id;

        var resolveResponse = await client.PostAsync($"/api/mod/reports/{reportId}/resolve", content: null);
        resolveResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var banResponse = await client.PostAsync($"/api/mod/users/{normal.User.Id}/ban", content: null);
        banResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        UseBearer(client, normal.AccessToken);
        var bannedPostResponse = await client.PostAsJsonAsync("/api/messages", new
        {
            room_id = room.Id,
            body = "blocked"
        });
        bannedPostResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        UseBearer(client, moderator.AccessToken);
        var moderatorRoleResponse = await client.PostAsJsonAsync($"/api/mod/users/{futureMod.User.Id}/roles", new
        {
            role = "moderator",
            grant = true
        });
        moderatorRoleResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        UseBearer(client, admin.AccessToken);
        var adminRoleResponse = await client.PostAsJsonAsync($"/api/mod/users/{futureMod.User.Id}/roles", new
        {
            role = "moderator",
            grant = true
        });
        adminRoleResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        futureMod = await LoginAsync(client, futureMod.Email);
        UseBearer(client, futureMod.AccessToken);
        var futureModReportsResponse = await client.GetAsync("/api/mod/reports");
        futureModReportsResponse.StatusCode.Should().Be(HttpStatusCode.OK);
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

    private sealed record ModReportDto(
        [property: JsonPropertyName("id")] Guid Id,
        [property: JsonPropertyName("message_id")] Guid MessageId,
        [property: JsonPropertyName("reporter_id")] Guid ReporterId,
        [property: JsonPropertyName("reason")] string Reason,
        [property: JsonPropertyName("note")] string? Note,
        [property: JsonPropertyName("status")] string Status,
        [property: JsonPropertyName("message_body")] string MessageBody,
        [property: JsonPropertyName("message_author_id")] Guid MessageAuthorId);
}
