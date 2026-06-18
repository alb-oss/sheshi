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

// Integration coverage for the civic proposals feature against a real Postgres (Testcontainers). The
// factory shrinks the approval quorum to 3 (ratio stays the real 0.60) so promotion is drivable here.
public class ProposalApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Full_lifecycle_submit_is_pending_then_published_then_voted_to_approved()
    {
        var author = await NewUserAsync("author");
        var mod = await NewModeratorAsync();

        var id = await SubmitAsync(author, category: "shendetesi");

        // Pending → not in the public Propozuara list, but present in the moderator queue.
        (await ListAsync(author, "proposed")).Should().NotContain(p => p.Id == id);
        (await ListAsync(mod, "pending-queue")).Should().Contain(p => p.Id == id);

        await PublishAsync(mod, id);

        // Published → now visible to the public, status "proposed", zero votes.
        var afterPublish = (await ListAsync(author, "proposed")).Single(p => p.Id == id);
        afterPublish.Status.Should().Be("proposed");
        afterPublish.Score.Should().Be(0);

        // Three distinct PRO votes clear quorum (3) and ratio (1.0 ≥ 0.60) → Approved.
        foreach (var label in new[] { "v1", "v2", "v3" })
        {
            var voter = await NewUserAsync(label);
            (await voter.PutAsJsonAsync($"/api/proposals/{id}/vote", new { value = 1 }))
                .StatusCode.Should().Be(HttpStatusCode.NoContent);
        }

        var approved = await GetAsync(author, id);
        approved!.Status.Should().Be("approved");
        approved.Score.Should().Be(3);
        approved.Pro.Should().Be(3);

        // Leaves Propozuara, lands in Miratuara.
        (await ListAsync(author, "proposed")).Should().NotContain(p => p.Id == id);
        (await ListAsync(author, "approved")).Should().Contain(p => p.Id == id);
    }

    [Fact]
    public async Task Pending_proposal_is_visible_to_its_author_but_404_to_others()
    {
        var author = await NewUserAsync("owner");
        var stranger = await NewUserAsync("stranger");
        var id = await SubmitAsync(author);

        (await author.GetAsync($"/api/proposals/{id}")).StatusCode.Should().Be(HttpStatusCode.OK);
        (await stranger.GetAsync($"/api/proposals/{id}")).StatusCode.Should().Be(HttpStatusCode.NotFound);
        // The public list cannot be coaxed into returning pending items.
        (await stranger.GetAsync("/api/proposals?status=pending")).StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Queue_and_moderation_actions_require_a_moderator()
    {
        var anon = factory.CreateClient();
        var user = await NewUserAsync("plain");
        var id = await SubmitAsync(user);

        (await anon.GetAsync("/api/proposals/queue")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await user.GetAsync("/api/proposals/queue")).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await user.PutAsJsonAsync($"/api/proposals/{id}/review", new { action = "publish" }))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await user.PutAsJsonAsync($"/api/proposals/{id}/close", new { }))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Vote_rules_reject_anon_banned_invalid_and_unpublished()
    {
        var author = await NewUserAsync("vauthor");
        var mod = await NewModeratorAsync();
        var id = await SubmitAsync(author);

        // Voting on a Pending proposal is closed.
        var voter = await NewUserAsync("v");
        (await voter.PutAsJsonAsync($"/api/proposals/{id}/vote", new { value = 1 }))
            .StatusCode.Should().Be(HttpStatusCode.Conflict);

        await PublishAsync(mod, id);

        // Anonymous → 401; bad value → 400.
        (await factory.CreateClient().PutAsJsonAsync($"/api/proposals/{id}/vote", new { value = 1 }))
            .StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await voter.PutAsJsonAsync($"/api/proposals/{id}/vote", new { value = 2 }))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);

        // A valid PRO then un-vote (0) nets back to zero.
        (await voter.PutAsJsonAsync($"/api/proposals/{id}/vote", new { value = 1 }))
            .StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await voter.PutAsJsonAsync($"/api/proposals/{id}/vote", new { value = 0 }))
            .StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await GetAsync(voter, id))!.Score.Should().Be(0);

        // Banned users cannot vote (403), even with a still-valid access token.
        var bannedClient = factory.CreateClient();
        var bannedAuth = await RegisterAsync(bannedClient, "banned");
        UseBearer(bannedClient, bannedAuth.AccessToken);
        await WithServicesAsync(async sp =>
        {
            var users = sp.GetRequiredService<UserManager<ApplicationUser>>();
            var u = await users.FindByEmailAsync(bannedAuth.Email);
            u!.BannedAt = DateTimeOffset.UtcNow;
            await users.UpdateAsync(u);
        });
        (await bannedClient.PutAsJsonAsync($"/api/proposals/{id}/vote", new { value = 1 }))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Promotion_respects_quorum_and_supermajority_boundary()
    {
        var author = await NewUserAsync("bauthor");
        var mod = await NewModeratorAsync();
        var id = await SubmitAsync(author);
        await PublishAsync(mod, id);

        // Promotion is re-evaluated on every vote, so order matters: keep the ratio below 0.60 until the
        // very end. Two KUNDËR first — below the quorum of 3 → still Proposed.
        await VoteAsync("bk1", id, -1);
        await VoteAsync("bk2", id, -1);
        (await GetAsync(author, id))!.Status.Should().Be("proposed");

        // One PRO: quorum is now met (3 votes) but the PRO share is 1/3 ≈ 0.33 < 0.60 → still Proposed.
        await VoteAsync("bp1", id, 1);
        var mid = await GetAsync(author, id);
        mid!.Status.Should().Be("proposed");
        mid.Pro.Should().Be(1);
        mid.Kunder.Should().Be(2);

        // Two more PRO → 3/5 = 0.60, exactly the threshold → Approved.
        await VoteAsync("bp2", id, 1);
        await VoteAsync("bp3", id, 1);
        (await GetAsync(author, id))!.Status.Should().Be("approved");
    }

    [Fact]
    public async Task Concurrent_votes_from_the_same_user_are_idempotent_not_500()
    {
        // Regression: a double-tap fires two simultaneous votes; without the atomic ON CONFLICT upsert both
        // INSERT and the second violates the (ProposalId, UserId) PK — an unhandled 23505 → HTTP 500.
        var author = await NewUserAsync("cauthor");
        var mod = await NewModeratorAsync();
        var id = await SubmitAsync(author);
        await PublishAsync(mod, id);

        var voter = await RegisterAsync(factory.CreateClient(), "race");
        var c1 = factory.CreateClient(); UseBearer(c1, voter.AccessToken);
        var c2 = factory.CreateClient(); UseBearer(c2, voter.AccessToken);

        var results = await Task.WhenAll(
            c1.PutAsJsonAsync($"/api/proposals/{id}/vote", new { value = 1 }),
            c2.PutAsJsonAsync($"/api/proposals/{id}/vote", new { value = 1 }));

        results.Should().OnlyContain(r => r.StatusCode == HttpStatusCode.NoContent,
            "concurrent same-user votes must both return 204, never 500");
        (await GetAsync(c1, id))!.Score.Should().Be(1, "exactly one vote row may exist after a double-tap");
    }

    [Fact]
    public async Task Author_may_edit_only_before_a_vote_and_only_their_own()
    {
        var author = await NewUserAsync("eauthor");
        var stranger = await NewUserAsync("estranger");
        var mod = await NewModeratorAsync();
        var id = await SubmitAsync(author);

        // Editable while pending, no votes.
        (await author.PutAsJsonAsync($"/api/proposals/{id}", new { title = "Titull i ri", body = "Trup i ri i propozimit." }))
            .StatusCode.Should().Be(HttpStatusCode.NoContent);
        // Not the author → 403.
        (await stranger.PutAsJsonAsync($"/api/proposals/{id}", new { title = "Hak", body = "Përmbajtje e padrejtë." }))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);

        await PublishAsync(mod, id);
        await VoteAsync("ev", id, 1);

        // Once a vote exists, the author can no longer edit (no bait-and-switch).
        (await author.PutAsJsonAsync($"/api/proposals/{id}", new { title = "Pas votimit", body = "Përpjekje për ndryshim." }))
            .StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task Withdraw_soft_deletes_and_hides_the_proposal()
    {
        var author = await NewUserAsync("wauthor");
        var mod = await NewModeratorAsync();
        var id = await SubmitAsync(author);
        await PublishAsync(mod, id);

        (await author.DeleteAsync($"/api/proposals/{id}")).StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await author.GetAsync($"/api/proposals/{id}")).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await ListAsync(author, "proposed")).Should().NotContain(p => p.Id == id);
    }

    [Fact]
    public async Task Moderator_reject_removes_from_queue_and_keeps_it_off_the_public_list()
    {
        var author = await NewUserAsync("rauthor");
        var mod = await NewModeratorAsync();
        var id = await SubmitAsync(author);

        (await mod.PutAsJsonAsync($"/api/proposals/{id}/review", new { action = "reject" }))
            .StatusCode.Should().Be(HttpStatusCode.NoContent);

        (await ListAsync(mod, "pending-queue")).Should().NotContain(p => p.Id == id);
        (await ListAsync(author, "proposed")).Should().NotContain(p => p.Id == id);
    }

    [Fact]
    public async Task Crossing_the_threshold_broadcasts_proposal_approved_to_the_feed()
    {
        var author = await NewUserAsync("realtime-author");
        var mod = await NewModeratorAsync();
        var id = await SubmitAsync(author);
        await PublishAsync(mod, id);

        var approved = new TaskCompletionSource<Guid>(TaskCreationOptions.RunContinuationsAsynchronously);
        var setupClient = factory.CreateClient();
        await using var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(setupClient.BaseAddress!, "/hub"),
                o => o.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler())
            .Build();
        connection.On<ApprovedEvent>("proposal_approved", e =>
        {
            if (e.Id == id) approved.TrySetResult(e.Id);
        });
        await connection.StartAsync();
        await connection.InvokeAsync("JoinProposals");

        foreach (var label in new[] { "rt1", "rt2", "rt3" })
            await VoteAsync(label, id, 1);

        var fired = await approved.Task.WaitAsync(TimeSpan.FromSeconds(5));
        fired.Should().Be(id);
    }

    // --- helpers ---

    private async Task<HttpClient> NewUserAsync(string label)
    {
        var client = factory.CreateClient();
        var auth = await RegisterAsync(client, label);
        UseBearer(client, auth.AccessToken);
        return client;
    }

    private async Task<HttpClient> NewModeratorAsync()
    {
        var setup = factory.CreateClient();
        var mod = await RegisterAsync(setup, "mod");
        await MakeModeratorAsync(mod.Email);
        // Re-login: the registration token predates the role grant, so [Authorize(Roles=...)] needs a fresh
        // token carrying the moderator claim.
        var fresh = await LoginAsync(setup, mod.Email);
        var client = factory.CreateClient();
        UseBearer(client, fresh.AccessToken);
        return client;
    }

    private async Task VoteAsync(string label, Guid id, int value)
    {
        var voter = await NewUserAsync(label);
        (await voter.PutAsJsonAsync($"/api/proposals/{id}/vote", new { value }))
            .StatusCode.Should().Be(HttpStatusCode.NoContent);
    }

    private static async Task<Guid> SubmitAsync(
        HttpClient client, string category = "ligje",
        string title = "Titull propozimi", string body = "Përmbajtja e propozimit qytetar.")
    {
        var res = await client.PostAsJsonAsync("/api/proposals", new { title, body, category });
        res.StatusCode.Should().Be(HttpStatusCode.Created);
        var dto = await res.Content.ReadFromJsonAsync<ProposalDto>();
        dto.Should().NotBeNull();
        return dto!.Id;
    }

    private static async Task PublishAsync(HttpClient modClient, Guid id) =>
        (await modClient.PutAsJsonAsync($"/api/proposals/{id}/review", new { action = "publish" }))
            .StatusCode.Should().Be(HttpStatusCode.NoContent);

    private static async Task<IReadOnlyList<ProposalDto>> ListAsync(HttpClient client, string which)
    {
        var path = which == "pending-queue" ? "/api/proposals/queue" : $"/api/proposals?status={which}";
        var res = await client.GetAsync(path);
        res.StatusCode.Should().Be(HttpStatusCode.OK);
        return (await res.Content.ReadFromJsonAsync<ProposalDto[]>())!;
    }

    private static async Task<ProposalDto?> GetAsync(HttpClient client, Guid id) =>
        await client.GetFromJsonAsync<ProposalDto>($"/api/proposals/{id}");

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
        var response = await client.PostAsJsonAsync("/api/auth/login", new { email, password = "Password123!" });
        response.EnsureSuccessStatusCode();
        var auth = await response.Content.ReadFromJsonAsync<AuthResponse>();
        auth.Should().NotBeNull();
        return auth! with { Email = email };
    }

    private static void UseBearer(HttpClient client, string accessToken) =>
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

    private async Task MakeModeratorAsync(string email)
    {
        await WithServicesAsync(async sp =>
        {
            var users = sp.GetRequiredService<UserManager<ApplicationUser>>();
            await users.AddToRoleAsync((await users.FindByEmailAsync(email))!, Roles.Moderator);
        });
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

    private sealed record UserDto(
        [property: JsonPropertyName("id")] Guid Id,
        [property: JsonPropertyName("email")] string? Email);

    private sealed record ProposalDto(
        [property: JsonPropertyName("id")] Guid Id,
        [property: JsonPropertyName("title")] string Title,
        [property: JsonPropertyName("body")] string Body,
        [property: JsonPropertyName("category")] string Category,
        [property: JsonPropertyName("status")] string Status,
        [property: JsonPropertyName("author_id")] Guid AuthorId,
        [property: JsonPropertyName("score")] int Score,
        [property: JsonPropertyName("pro")] int Pro,
        [property: JsonPropertyName("kunder")] int Kunder,
        [property: JsonPropertyName("my_vote")] int MyVote);

    private sealed record ApprovedEvent([property: JsonPropertyName("id")] Guid Id);
}
