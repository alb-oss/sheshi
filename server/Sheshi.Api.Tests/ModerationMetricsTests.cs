using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using FluentAssertions;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Tests;

public class ModerationMetricsTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Metrics_endpoint_counts_open_reports_flags_and_recent_actions()
    {
        var client = factory.CreateClient();
        var reporter = await RegisterAsync(client, "metricsreporter");
        var author = await RegisterAsync(client, "metricsauthor");
        var bannedUser = await RegisterAsync(client, "metricsbanned");
        var moderator = await RegisterAsync(client, "metricsmod");
        var room = await GetRoomAsync(client, "sheshi");

        await MakeModeratorAsync(moderator.Email);

        UseBearer(client, author.AccessToken);
        var openReportMessage = await PostMessageAsync(client, room.Id, "open report target");
        var resolvedReportMessage = await PostMessageAsync(client, room.Id, "resolved report target");
        var deletedMessage = await PostMessageAsync(client, room.Id, "delete target");
        await PostMessageAsync(client, room.Id, "email flag metric@example.com");

        UseBearer(client, reporter.AccessToken);
        await ReportMessageAsync(client, openReportMessage.Id, "spam");
        await ReportMessageAsync(client, resolvedReportMessage.Id, "hate");

        moderator = await LoginAsync(client, moderator.Email);
        UseBearer(client, moderator.AccessToken);
        var reports = await client.GetFromJsonAsync<ModReportDto[]>("/api/mod/reports?status=open");
        reports.Should().NotBeNull();
        var reportToResolve = reports!.Single(r => r.MessageId == resolvedReportMessage.Id);
        var resolveResponse = await client.PostAsync($"/api/mod/reports/{reportToResolve.Id}/resolve", content: null);
        resolveResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var banResponse = await client.PostAsync($"/api/mod/users/{bannedUser.User.Id}/ban", content: null);
        banResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var deleteResponse = await client.DeleteAsync($"/api/messages/{deletedMessage.Id}");
        deleteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var metricsResponse = await client.GetAsync("/api/mod/metrics");
        metricsResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var metrics = await metricsResponse.Content.ReadFromJsonAsync<ModerationMetricsDto>();
        metrics.Should().NotBeNull();
        metrics!.OpenReports.Should().Be(1);
        metrics.OpenFlags.Should().Be(1);
        metrics.ResolvedReports7d.Should().Be(1);
        metrics.Bans7d.Should().Be(1);
        metrics.DeletedMessages7d.Should().Be(1);
        metrics.ReportsByReason.Should().Contain(r => r.Key == "spam" && r.Count == 1);
        metrics.FlagsByRule.Should().Contain(r => r.Key == "doxxing.email" && r.Count == 1);
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

    private static async Task<MessageDto> PostMessageAsync(HttpClient client, Guid roomId, string body)
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

    private static async Task ReportMessageAsync(HttpClient client, Guid messageId, string reason)
    {
        var response = await client.PostAsJsonAsync($"/api/messages/{messageId}/report", new
        {
            reason
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

    private sealed record MessageDto(
        [property: JsonPropertyName("id")] Guid Id,
        [property: JsonPropertyName("room_id")] Guid RoomId);

    private sealed record ModReportDto(
        [property: JsonPropertyName("id")] Guid Id,
        [property: JsonPropertyName("message_id")] Guid MessageId);

    private sealed record ModerationMetricsDto(
        [property: JsonPropertyName("open_reports")] int OpenReports,
        [property: JsonPropertyName("open_flags")] int OpenFlags,
        [property: JsonPropertyName("average_resolution_hours_7d")] double? AverageResolutionHours7d,
        [property: JsonPropertyName("oldest_open_item_hours")] double? OldestOpenItemHours,
        [property: JsonPropertyName("resolved_reports_7d")] int ResolvedReports7d,
        [property: JsonPropertyName("bans_7d")] int Bans7d,
        [property: JsonPropertyName("deleted_messages_7d")] int DeletedMessages7d,
        [property: JsonPropertyName("reports_by_reason")] MetricBucketDto[] ReportsByReason,
        [property: JsonPropertyName("flags_by_rule")] MetricBucketDto[] FlagsByRule);

    private sealed record MetricBucketDto(
        [property: JsonPropertyName("key")] string Key,
        [property: JsonPropertyName("count")] int Count);
}
