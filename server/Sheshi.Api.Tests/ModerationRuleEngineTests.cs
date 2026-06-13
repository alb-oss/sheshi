using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using FluentAssertions;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Sheshi.Api.Domain;
using Sheshi.Api.Features.Moderation;

namespace Sheshi.Api.Tests;

public class ModerationRuleEngineTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Default_classifier_returns_no_results()
    {
        var classifier = new NoopContentClassifier();

        var results = await classifier.ClassifyAsync("benign local text");

        results.Should().BeEmpty();
    }

    [Fact]
    public async Task Posting_message_with_email_creates_redacted_doxxing_flag()
    {
        var client = factory.CreateClient();
        var author = await RegisterAsync(client, "flagemailauthor");
        var moderator = await RegisterAsync(client, "flagemailmod");
        var room = await GetRoomAsync(client, "sheshi");

        await MakeModeratorAsync(moderator.Email);

        UseBearer(client, author.AccessToken);
        await PostMessageAsync(client, room.Id, "Reach me at private.person@example.com");

        moderator = await LoginAsync(client, moderator.Email);
        UseBearer(client, moderator.AccessToken);
        var flagsResponse = await client.GetAsync("/api/mod/flags?status=open");
        flagsResponse.StatusCode.Should().Be(HttpStatusCode.OK);

        var flags = await flagsResponse.Content.ReadFromJsonAsync<ModFlagDto[]>();
        flags.Should().NotBeNull();
        var flag = flags!.Should().ContainSingle(f => f.RuleKey == "doxxing.email").Subject;
        flag.Category.Should().Be("doxxing");
        flag.Severity.Should().Be("high");
        flag.Evidence.Should().NotContain("private.person@example.com");
    }

    [Fact]
    public async Task Repeated_same_author_messages_create_duplicate_spam_flag()
    {
        var client = factory.CreateClient();
        var author = await RegisterAsync(client, "flagspamauthor");
        var moderator = await RegisterAsync(client, "flagspammod");
        var room = await GetRoomAsync(client, "sheshi");

        await MakeModeratorAsync(moderator.Email);

        UseBearer(client, author.AccessToken);
        await PostMessageAsync(client, room.Id, "same promo text");
        await PostMessageAsync(client, room.Id, "same promo text");
        await PostMessageAsync(client, room.Id, "same promo text");

        moderator = await LoginAsync(client, moderator.Email);
        UseBearer(client, moderator.AccessToken);
        var flagsResponse = await client.GetAsync("/api/mod/flags?status=open");
        flagsResponse.StatusCode.Should().Be(HttpStatusCode.OK);

        var flags = await flagsResponse.Content.ReadFromJsonAsync<ModFlagDto[]>();
        flags.Should().NotBeNull();
        flags.Should().Contain(f => f.RuleKey == "spam.duplicate_text" && f.Category == "spam");
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

    private async Task MakeModeratorAsync(string email)
    {
        using var scope = factory.Services.CreateScope();
        var userManager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        await userManager.AddToRoleAsync((await userManager.FindByEmailAsync(email))!, Roles.Moderator);
    }

    private async Task<RoomDto> GetRoomAsync(HttpClient client, string slug)
    {
        var room = await client.GetFromJsonAsync<RoomDto>($"/api/rooms/{slug}");
        room.Should().NotBeNull();
        return room!;
    }

    private static async Task PostMessageAsync(HttpClient client, Guid roomId, string body)
    {
        var response = await client.PostAsJsonAsync("/api/messages", new
        {
            room_id = roomId,
            body
        });
        response.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    private static void UseBearer(HttpClient client, string accessToken) =>
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

    private sealed record AuthResponse(
        [property: JsonPropertyName("access_token")] string AccessToken,
        [property: JsonPropertyName("refresh_token")] string RefreshToken,
        [property: JsonPropertyName("user")] UserDto User)
    {
        public string Email { get; init; } = User.Email ?? "";
    }

    private sealed record UserDto(
        [property: JsonPropertyName("id")] Guid Id,
        [property: JsonPropertyName("email")] string? Email);

    private sealed record RoomDto(
        [property: JsonPropertyName("id")] Guid Id,
        [property: JsonPropertyName("slug")] string Slug);

    private sealed record ModFlagDto(
        [property: JsonPropertyName("id")] Guid Id,
        [property: JsonPropertyName("message_id")] Guid MessageId,
        [property: JsonPropertyName("room_id")] Guid RoomId,
        [property: JsonPropertyName("author_id")] Guid AuthorId,
        [property: JsonPropertyName("rule_key")] string RuleKey,
        [property: JsonPropertyName("category")] string Category,
        [property: JsonPropertyName("severity")] string Severity,
        [property: JsonPropertyName("score")] double Score,
        [property: JsonPropertyName("evidence")] string Evidence,
        [property: JsonPropertyName("status")] string Status,
        [property: JsonPropertyName("created_at")] DateTimeOffset CreatedAt);
}
