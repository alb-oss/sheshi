using System.Net.Http.Json;
using System.Text.Json.Serialization;
using FluentAssertions;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Tests;

// Dedicated fixture so the per-connection throttle state / PresenceTracker can't be contaminated by
// other realtime tests sharing a host.
public class HubThrottleTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Anonymous_connection_can_join_a_room_and_stays_connected()
    {
        // Regression guard: the hub must remain usable WITHOUT auth so logged-out readers get live
        // updates. The hardening must not turn this into an authenticated-only hub.
        await using var connection = Connect();
        await connection.StartAsync();

        await connection.InvokeAsync("JoinRoom", Guid.NewGuid());

        connection.State.Should().Be(HubConnectionState.Connected);
    }

    [Fact]
    public async Task JoinModeration_is_forbidden_for_an_anonymous_caller()
    {
        await using var connection = Connect();
        await connection.StartAsync();

        var act = async () => await connection.InvokeAsync("JoinModeration");

        (await act.Should().ThrowAsync<HubException>()).Which.Message.Should().Contain("FORBIDDEN");
    }

    [Fact]
    public async Task Joining_more_than_the_per_connection_group_cap_is_rejected()
    {
        await using var connection = Connect();
        await connection.StartAsync();

        // The cap is 10 concurrent group memberships per connection.
        for (var i = 0; i < 10; i++)
            await connection.InvokeAsync("JoinRoom", Guid.NewGuid());

        var act = async () => await connection.InvokeAsync("JoinRoom", Guid.NewGuid());

        (await act.Should().ThrowAsync<HubException>()).Which.Message.Should().Contain("RATE_LIMITED");
    }

    [Fact]
    public async Task JoinModeration_succeeds_for_a_moderator()
    {
        var client = factory.CreateClient();
        var email = $"hub-mod-{Guid.NewGuid():N}@example.com";
        (await client.PostAsJsonAsync("/api/auth/register",
            new { email, password = "Password123!", display_name = "mod" })).EnsureSuccessStatusCode();

        // Elevate to moderator, then re-login so the JWT carries the new role claim.
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var user = await users.FindByEmailAsync(email);
            await users.AddToRoleAsync(user!, "moderator");
        }
        var login = await (await client.PostAsJsonAsync("/api/auth/login",
            new { email, password = "Password123!" })).Content.ReadFromJsonAsync<AuthResponse>();

        await using var connection = Connect(login!.AccessToken);
        await connection.StartAsync();

        // Must not throw — a moderator is allowed into the queue.
        await connection.InvokeAsync("JoinModeration");
        connection.State.Should().Be(HubConnectionState.Connected);
    }

    private HubConnection Connect(string? accessToken = null) =>
        new HubConnectionBuilder()
            .WithUrl(new Uri(factory.CreateClient().BaseAddress!, "/hub"), options =>
            {
                options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
                if (accessToken is not null)
                    options.AccessTokenProvider = () => Task.FromResult<string?>(accessToken);
            })
            .Build();

    private sealed record AuthResponse(
        [property: JsonPropertyName("access_token")] string AccessToken);
}
