using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using FluentAssertions;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Tests;

public class RealtimeStorageModerationTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task SignalR_room_members_receive_realtime_events_and_presence_counts_update()
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
        // Clients consume the typed delta directly (the legacy coarse "changed" signal was removed).
        connection.On<object>("message_created", _ => changed.TrySetResult());

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
        var image = new ByteArrayContent(CreateOnePixelPng());
        image.Headers.ContentType = MediaTypeHeaderValue.Parse("image/png");
        form.Add(image, "image", "pixel.png");

        var response = await client.PostAsync("/api/messages", form);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var message = await response.Content.ReadFromJsonAsync<MessageDto>();
        message.Should().NotBeNull();
        message!.ImageUrl.Should().StartWith("http://localhost:5080/uploads/");
    }

    [Fact]
    public async Task Multipart_image_only_post_saves_image_without_text_body()
    {
        var client = factory.CreateClient();
        var user = await RegisterAsync(client, "image-only");
        var room = await GetRoomAsync(client, "sheshi");
        UseBearer(client, user.AccessToken);

        using var form = new MultipartFormDataContent();
        form.Add(new StringContent(room.Id.ToString()), "room_id");
        form.Add(new StringContent("   "), "body");
        var image = new ByteArrayContent(CreateOnePixelPng());
        image.Headers.ContentType = MediaTypeHeaderValue.Parse("image/png");
        form.Add(image, "image", "pixel.png");

        var response = await client.PostAsync("/api/messages", form);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var message = await response.Content.ReadFromJsonAsync<MessageDto>();
        message.Should().NotBeNull();
        message!.Body.Should().Be("");
        message.ImageUrl.Should().StartWith("http://localhost:5080/uploads/");
    }

    [Fact]
    public async Task Multipart_upload_rejects_disguised_image_bytes()
    {
        var client = factory.CreateClient();
        var user = await RegisterAsync(client, "fake-image");
        var room = await GetRoomAsync(client, "sheshi");
        UseBearer(client, user.AccessToken);

        using var form = new MultipartFormDataContent();
        form.Add(new StringContent(room.Id.ToString()), "room_id");
        form.Add(new StringContent("fake image"), "body");
        var image = new ByteArrayContent("this is not a png"u8.ToArray());
        image.Headers.ContentType = MediaTypeHeaderValue.Parse("image/png");
        form.Add(image, "image", "fake.png");

        var response = await client.PostAsync("/api/messages", form);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var payload = await response.Content.ReadFromJsonAsync<ErrorDto>();
        payload.Should().NotBeNull();
        payload!.Error.Should().Be("INVALID_IMAGE");
    }

    [Fact]
    public async Task Multipart_message_post_saves_video_and_returns_video_url()
    {
        var client = factory.CreateClient();
        var user = await RegisterAsync(client, "video");
        var room = await GetRoomAsync(client, "sheshi");
        UseBearer(client, user.AccessToken);

        using var form = new MultipartFormDataContent();
        form.Add(new StringContent(room.Id.ToString()), "room_id");
        form.Add(new StringContent("Message with video"), "body");
        var video = new ByteArrayContent(CreateMinimalMp4());
        video.Headers.ContentType = MediaTypeHeaderValue.Parse("video/mp4");
        form.Add(video, "video", "clip.mp4");

        var response = await client.PostAsync("/api/messages", form);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var message = await response.Content.ReadFromJsonAsync<MessageDto>();
        message.Should().NotBeNull();
        message!.VideoUrl.Should().StartWith("http://localhost:5080/uploads/");
        message.VideoUrl.Should().EndWith(".mp4");
    }

    [Fact]
    public async Task Multipart_upload_rejects_disguised_video_bytes()
    {
        var client = factory.CreateClient();
        var user = await RegisterAsync(client, "fake-video");
        var room = await GetRoomAsync(client, "sheshi");
        UseBearer(client, user.AccessToken);

        using var form = new MultipartFormDataContent();
        form.Add(new StringContent(room.Id.ToString()), "room_id");
        form.Add(new StringContent("fake video"), "body");
        var video = new ByteArrayContent("this is not an mp4 container"u8.ToArray());
        video.Headers.ContentType = MediaTypeHeaderValue.Parse("video/mp4");
        form.Add(video, "video", "fake.mp4");

        var response = await client.PostAsync("/api/messages", form);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var payload = await response.Content.ReadFromJsonAsync<ErrorDto>();
        payload.Should().NotBeNull();
        payload!.Error.Should().Be("INVALID_VIDEO");
    }

    [Fact]
    public async Task Multipart_upload_rewrites_image_and_drops_trailing_payload()
    {
        var uploadPath = Path.Combine(Path.GetTempPath(), $"sheshi-safe-images-{Guid.NewGuid():N}");
        var client = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Storage:UploadPath"] = uploadPath,
                    ["Storage:PublicBaseUrl"] = "http://localhost:5080/uploads"
                });
            });
        }).CreateClient();
        var user = await RegisterAsync(client, "clean-image");
        var room = await GetRoomAsync(client, "sheshi");
        UseBearer(client, user.AccessToken);

        var cleanPng = CreateOnePixelPng();
        var pngWithMetadata = AddPngTextChunk(cleanPng, "Comment", "SECRET-GPS-PAYLOAD");
        using var form = new MultipartFormDataContent();
        form.Add(new StringContent(room.Id.ToString()), "room_id");
        var image = new ByteArrayContent(pngWithMetadata);
        image.Headers.ContentType = MediaTypeHeaderValue.Parse("image/png");
        form.Add(image, "image", "pixel.png");

        var response = await client.PostAsync("/api/messages", form);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var message = await response.Content.ReadFromJsonAsync<MessageDto>();
        message.Should().NotBeNull();
        var savedName = new Uri(message!.ImageUrl!).Segments.Last();
        var savedBytes = await File.ReadAllBytesAsync(Path.Combine(uploadPath, savedName));
        System.Text.Encoding.Latin1.GetString(savedBytes).Should().NotContain("SECRET-GPS-PAYLOAD");
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
        // Report from a different user — you can't report your own message.
        UseBearer(client, normal.AccessToken);
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

        var actionsResponse = await client.GetAsync("/api/mod/actions");
        actionsResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var actions = await actionsResponse.Content.ReadFromJsonAsync<ModActionDto[]>();
        actions.Should().NotBeNull();
        actions!.Select(a => a.ActionType)
            .Should()
            .Contain([
                "report_resolved",
                "user_banned",
                "role_granted"
            ]);

        futureMod = await LoginAsync(client, futureMod.Email);
        UseBearer(client, futureMod.AccessToken);
        var futureModReportsResponse = await client.GetAsync("/api/mod/reports");
        futureModReportsResponse.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    // Regression: banning a reported author must surface on their open reports so the moderation
    // UI can reflect the block (previously the report DTO carried no banned flag, so the card
    // looked unchanged after a ban).
    [Fact]
    public async Task Open_report_reflects_author_banned_status_after_ban()
    {
        var client = factory.CreateClient();
        var author = await RegisterAsync(client, "banauthor");
        var reporter = await RegisterAsync(client, "banreporter");
        var moderator = await RegisterAsync(client, "banmod");
        var room = await GetRoomAsync(client, "sheshi");

        await WithServicesAsync(async sp =>
        {
            var userManager = sp.GetRequiredService<UserManager<ApplicationUser>>();
            await userManager.AddToRoleAsync((await userManager.FindByEmailAsync(moderator.Email))!, Roles.Moderator);
        });
        moderator = await LoginAsync(client, moderator.Email);

        UseBearer(client, author.AccessToken);
        var postResponse = await client.PostAsJsonAsync("/api/messages", new { room_id = room.Id, body = "Needs moderation" });
        var message = await postResponse.Content.ReadFromJsonAsync<MessageDto>();
        message.Should().NotBeNull();

        UseBearer(client, reporter.AccessToken);
        await ReportAsync(client, message!.Id, "spam");

        UseBearer(client, moderator.AccessToken);
        var before = await client.GetFromJsonAsync<ModReportDto[]>("/api/mod/reports?status=open");
        before.Should().NotBeNull();
        before!.Single(r => r.MessageId == message.Id).MessageAuthorBanned.Should().BeFalse();

        var banResponse = await client.PostAsync($"/api/mod/users/{author.User.Id}/ban", content: null);
        banResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var after = await client.GetFromJsonAsync<ModReportDto[]>("/api/mod/reports?status=open");
        after.Should().NotBeNull();
        after!.Single(r => r.MessageId == message.Id).MessageAuthorBanned.Should().BeTrue();
    }

    [Fact]
    public async Task Moderation_reports_can_be_filtered_by_reason()
    {
        var client = factory.CreateClient();
        var reporter = await RegisterAsync(client, "filterreporter");
        var author = await RegisterAsync(client, "filterauthor");
        var moderator = await RegisterAsync(client, "filtermod");
        var room = await GetRoomAsync(client, "sheshi");

        await WithServicesAsync(async sp =>
        {
            var userManager = sp.GetRequiredService<UserManager<ApplicationUser>>();
            await userManager.AddToRoleAsync((await userManager.FindByEmailAsync(moderator.Email))!, Roles.Moderator);
        });
        moderator = await LoginAsync(client, moderator.Email);

        UseBearer(client, author.AccessToken);
        var hateMessage = await CreateMessageAsync(client, room.Id, "Message reported for hate");
        var spamMessage = await CreateMessageAsync(client, room.Id, "Message reported for spam");

        UseBearer(client, reporter.AccessToken);
        var hateReport = await client.PostAsJsonAsync($"/api/messages/{hateMessage.Id}/report", new
        {
            reason = "hate"
        });
        hateReport.StatusCode.Should().Be(HttpStatusCode.Created);

        var spamReport = await client.PostAsJsonAsync($"/api/messages/{spamMessage.Id}/report", new
        {
            reason = "spam"
        });
        spamReport.StatusCode.Should().Be(HttpStatusCode.Created);

        UseBearer(client, moderator.AccessToken);
        var filteredResponse = await client.GetAsync("/api/mod/reports?status=open&reason=hate");
        filteredResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var filtered = await filteredResponse.Content.ReadFromJsonAsync<ModReportDto[]>();
        filtered.Should().NotBeNull();
        filtered.Should().ContainSingle(r => r.MessageId == hateMessage.Id && r.Reason == "hate");
        filtered.Should().OnlyContain(r => r.Reason == "hate");
    }

    [Fact]
    public async Task Report_inbox_can_filter_by_room_severity_repeat_offender_and_sort_age()
    {
        var client = factory.CreateClient();
        var reporter = await RegisterAsync(client, "workflowreporter");
        var repeatAuthor = await RegisterAsync(client, "workflowrepeat");
        var singleAuthor = await RegisterAsync(client, "workflowsingle");
        var moderator = await RegisterAsync(client, "workflowmod");
        var roomSlug = $"workflow-{Guid.NewGuid():N}";
        Guid roomId = default;

        await WithServicesAsync(async sp =>
        {
            var userManager = sp.GetRequiredService<UserManager<ApplicationUser>>();
            await userManager.AddToRoleAsync((await userManager.FindByEmailAsync(moderator.Email))!, Roles.Moderator);
            var db = sp.GetRequiredService<AppDbContext>();
            var room = new Room { Name = "Workflow", Slug = roomSlug, Description = "Workflow test room" };
            db.Rooms.Add(room);
            await db.SaveChangesAsync();
            roomId = room.Id;
        });
        moderator = await LoginAsync(client, moderator.Email);

        UseBearer(client, repeatAuthor.AccessToken);
        var repeatOne = await CreateMessageAsync(client, roomId, "first repeat offender report");
        var repeatTwo = await CreateMessageAsync(client, roomId, "second repeat offender report");
        UseBearer(client, singleAuthor.AccessToken);
        var single = await CreateMessageAsync(client, roomId, "single lower risk report");

        UseBearer(client, reporter.AccessToken);
        await ReportAsync(client, repeatOne.Id, "spam");
        await ReportAsync(client, repeatTwo.Id, "doxxing");
        await ReportAsync(client, single.Id, "other");

        UseBearer(client, moderator.AccessToken);
        var filteredResponse = await client.GetAsync($"/api/mod/reports?status=open&room_id={roomId}&min_severity=high&repeat_offender=true&sort=oldest");

        filteredResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var reports = await filteredResponse.Content.ReadFromJsonAsync<ModReportDto[]>();
        reports.Should().NotBeNull();
        reports!.Should().ContainSingle();
        reports[0].MessageId.Should().Be(repeatTwo.Id);
        reports[0].Severity.Should().Be("high");
        reports[0].RoomSlug.Should().Be(roomSlug);
        reports[0].AuthorOpenReportCount.Should().Be(2);
        reports[0].AgeHours.Should().BeGreaterThanOrEqualTo(0);
    }

    [Fact]
    public async Task Action_log_exposes_actor_details_metadata_and_filters()
    {
        var client = factory.CreateClient();
        var reporter = await RegisterAsync(client, "actionreporter");
        var author = await RegisterAsync(client, "actionauthor");
        var moderator = await RegisterAsync(client, "actionmod");
        var room = await GetRoomAsync(client, "sheshi");

        await WithServicesAsync(async sp =>
        {
            var userManager = sp.GetRequiredService<UserManager<ApplicationUser>>();
            await userManager.AddToRoleAsync((await userManager.FindByEmailAsync(moderator.Email))!, Roles.Moderator);
        });
        moderator = await LoginAsync(client, moderator.Email);

        UseBearer(client, author.AccessToken);
        var message = await CreateMessageAsync(client, room.Id, "action log target");
        UseBearer(client, reporter.AccessToken);
        await ReportAsync(client, message.Id, "hate");

        UseBearer(client, moderator.AccessToken);
        var reports = await client.GetFromJsonAsync<ModReportDto[]>("/api/mod/reports?status=open");
        var report = reports!.Single(r => r.MessageId == message.Id);
        var resolveResponse = await client.PostAsync($"/api/mod/reports/{report.Id}/resolve", content: null);
        resolveResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var actionsResponse = await client.GetAsync("/api/mod/actions?action_type=report_resolved&target_type=report");

        actionsResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var actions = await actionsResponse.Content.ReadFromJsonAsync<ModActionDto[]>();
        actions.Should().NotBeNull();
        actions!.Should().ContainSingle(a => a.TargetId == report.Id);
        var action = actions.Single(a => a.TargetId == report.Id);
        action.Actor.Username.Should().NotBeNullOrWhiteSpace();
        action.Metadata.Should().ContainKey("previous_status");
        action.Metadata["new_status"].Should().Be("resolved");
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

    private async Task<MessageDto> CreateMessageAsync(HttpClient client, Guid roomId, string body)
    {
        var response = await client.PostAsJsonAsync("/api/messages", new
        {
            room_id = roomId,
            body
        });
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var message = await response.Content.ReadFromJsonAsync<MessageDto>();
        message.Should().NotBeNull();
        return message!;
    }

    private static async Task ReportAsync(HttpClient client, Guid messageId, string reason)
    {
        var response = await client.PostAsJsonAsync($"/api/messages/{messageId}/report", new
        {
            reason
        });
        response.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    private static byte[] AddPngTextChunk(byte[] png, string key, string value)
    {
        var iendOffset = FindPngChunkOffset(png, "IEND");
        var chunkData = System.Text.Encoding.Latin1.GetBytes($"{key}\0{value}");
        var typeBytes = System.Text.Encoding.ASCII.GetBytes("tEXt");
        using var output = new MemoryStream();
        output.Write(png.AsSpan(0, iendOffset));
        WriteBigEndianUInt32(output, (uint)chunkData.Length);
        output.Write(typeBytes);
        output.Write(chunkData);
        WriteBigEndianUInt32(output, Crc32(typeBytes.Concat(chunkData).ToArray()));
        output.Write(png.AsSpan(iendOffset));
        return output.ToArray();
    }

    private static byte[] CreateOnePixelPng()
    {
        using var image = new Image<Rgba32>(1, 1);
        image[0, 0] = new Rgba32(255, 0, 0, 255);
        using var output = new MemoryStream();
        image.SaveAsPng(output);
        return output.ToArray();
    }

    // Smallest payload the video storage layer accepts: an ISO Base Media File Format 'ftyp' box.
    // size(4) + 'ftyp'(4) + major brand + minor version + compatible brand = 24 bytes. The
    // storage layer only checks for the 'ftyp' marker at byte offset 4 (shared by mp4/mov).
    private static byte[] CreateMinimalMp4() =>
    [
        0x00, 0x00, 0x00, 0x18,
        (byte)'f', (byte)'t', (byte)'y', (byte)'p',
        (byte)'i', (byte)'s', (byte)'o', (byte)'m',
        0x00, 0x00, 0x02, 0x00,
        (byte)'i', (byte)'s', (byte)'o', (byte)'m',
        (byte)'m', (byte)'p', (byte)'4', (byte)'2',
    ];

    private static int FindPngChunkOffset(byte[] png, string chunkType)
    {
        var offset = 8;
        while (offset + 8 <= png.Length)
        {
            var length = ReadBigEndianUInt32(png.AsSpan(offset, 4));
            var type = System.Text.Encoding.ASCII.GetString(png, offset + 4, 4);
            if (type == chunkType) return offset;
            offset += 12 + checked((int)length);
        }

        throw new InvalidOperationException($"PNG chunk {chunkType} not found.");
    }

    private static uint ReadBigEndianUInt32(ReadOnlySpan<byte> bytes) =>
        ((uint)bytes[0] << 24) | ((uint)bytes[1] << 16) | ((uint)bytes[2] << 8) | bytes[3];

    private static void WriteBigEndianUInt32(Stream stream, uint value)
    {
        Span<byte> bytes =
        [
            (byte)(value >> 24),
            (byte)(value >> 16),
            (byte)(value >> 8),
            (byte)value
        ];
        stream.Write(bytes);
    }

    private static uint Crc32(byte[] bytes)
    {
        var crc = 0xffffffffu;
        foreach (var b in bytes)
        {
            crc ^= b;
            for (var i = 0; i < 8; i++)
                crc = (crc & 1) == 1 ? (crc >> 1) ^ 0xedb88320u : crc >> 1;
        }

        return ~crc;
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
        [property: JsonPropertyName("video_url")] string? VideoUrl,
        [property: JsonPropertyName("deleted_at")] DateTimeOffset? DeletedAt,
        [property: JsonPropertyName("created_at")] DateTimeOffset CreatedAt,
        [property: JsonPropertyName("author")] AuthorDto? Author,
        [property: JsonPropertyName("score")] int Score,
        [property: JsonPropertyName("reply_count")] int ReplyCount,
        [property: JsonPropertyName("my_vote")] int MyVote);

    private sealed record ModReportDto(
        [property: JsonPropertyName("id")] Guid Id,
        [property: JsonPropertyName("message_id")] Guid MessageId,
        [property: JsonPropertyName("reporter_id")] Guid ReporterId,
        [property: JsonPropertyName("reason")] string Reason,
        [property: JsonPropertyName("note")] string? Note,
        [property: JsonPropertyName("status")] string Status,
        [property: JsonPropertyName("message_body")] string MessageBody,
        [property: JsonPropertyName("message_author_id")] Guid MessageAuthorId,
        [property: JsonPropertyName("room_id")] Guid RoomId,
        [property: JsonPropertyName("room_slug")] string RoomSlug,
        [property: JsonPropertyName("severity")] string Severity,
        [property: JsonPropertyName("created_at")] DateTimeOffset CreatedAt,
        [property: JsonPropertyName("age_hours")] double AgeHours,
        [property: JsonPropertyName("author_report_count")] int AuthorReportCount,
        [property: JsonPropertyName("author_open_report_count")] int AuthorOpenReportCount,
        [property: JsonPropertyName("author_open_flag_count")] int AuthorOpenFlagCount,
        [property: JsonPropertyName("message_author_banned")] bool MessageAuthorBanned);

    private sealed record ModActionDto(
        [property: JsonPropertyName("id")] Guid Id,
        [property: JsonPropertyName("actor_id")] Guid ActorId,
        [property: JsonPropertyName("action_type")] string ActionType,
        [property: JsonPropertyName("target_type")] string TargetType,
        [property: JsonPropertyName("target_id")] Guid TargetId,
        [property: JsonPropertyName("reason")] string? Reason,
        [property: JsonPropertyName("created_at")] DateTimeOffset CreatedAt,
        [property: JsonPropertyName("actor")] ModActorDto Actor,
        [property: JsonPropertyName("metadata")] Dictionary<string, string> Metadata);

    private sealed record ModActorDto(
        [property: JsonPropertyName("id")] Guid Id,
        [property: JsonPropertyName("username")] string? Username,
        [property: JsonPropertyName("display_name")] string? DisplayName);

    private sealed record ErrorDto([property: JsonPropertyName("error")] string Error);
}
