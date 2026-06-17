using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using FluentAssertions;
using Microsoft.AspNetCore.TestHost;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Sheshi.Api.Email;

namespace Sheshi.Api.Tests;

/// <summary>
/// Regression for the reset-password account-existence oracle (Finding 10): the endpoint used to leak
/// whether an email had an account by returning a generic { error = "INVALID_RESET_REQUEST" } for a
/// missing user but verbose Identity error descriptions ({ errors = [...] }) for an existing user with
/// a bad token/weak password. The fix collapses ALL failure modes to ONE identical generic response so
/// the caller cannot distinguish "no such account" from "account exists but token/password was bad".
/// Only a genuine reset differs (204). These tests assert the three failure responses are byte-for-byte
/// identical (status + body), carry no Identity descriptions, and that a fully-valid reset still works.
/// </summary>
public class ResetPasswordEnumerationTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Reset_password_failures_are_indistinguishable_across_missing_user_bad_token_and_weak_password()
    {
        var sender = new CapturingEmailSender();
        var client = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IEmailSender>();
                services.AddSingleton<IEmailSender>(sender);
            });
        }).CreateClient();

        // An existing account, with a genuine reset token issued for it.
        var existingEmail = $"oracle-existing-{Guid.NewGuid():N}@example.com";
        (await client.PostAsJsonAsync("/api/auth/register", new
        {
            email = existingEmail,
            password = "Password123!",
            display_name = "Oracle Existing"
        })).EnsureSuccessStatusCode();

        (await client.PostAsJsonAsync("/api/auth/forgot-password", new { email = existingEmail }))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        sender.ResetUrls.Should().ContainSingle();
        var validToken = QueryHelpers.ParseQuery(new Uri(sender.ResetUrls.Single()).Query)["token"].Single();

        // (a) nonexistent email — no account at all.
        var missingUser = await ReadResponse(await client.PostAsJsonAsync("/api/auth/reset-password", new
        {
            email = $"oracle-missing-{Guid.NewGuid():N}@example.com",
            token = validToken,
            password = "NewPassword123!"
        }));

        // (b) existing user, but a bogus reset token.
        var badToken = await ReadResponse(await client.PostAsJsonAsync("/api/auth/reset-password", new
        {
            email = existingEmail,
            token = "this-is-not-a-valid-reset-token",
            password = "NewPassword123!"
        }));

        // (c) existing user, a VALID token, but a password that fails the policy (too short).
        var weakPassword = await ReadResponse(await client.PostAsJsonAsync("/api/auth/reset-password", new
        {
            email = existingEmail,
            token = validToken,
            password = "x"
        }));

        // All three failures share the SAME status code — no 400-vs-other discrepancy to probe.
        missingUser.Status.Should().Be(HttpStatusCode.BadRequest);
        badToken.Status.Should().Be(missingUser.Status);
        weakPassword.Status.Should().Be(missingUser.Status);

        // And the SAME response body, byte-for-byte — the oracle's old "tell" (generic vs. Identity
        // descriptions) is gone. If any branch leaked details the bodies would diverge here.
        badToken.Body.Should().Be(missingUser.Body);
        weakPassword.Body.Should().Be(missingUser.Body);

        // The body is the single canonical generic shape and NEVER carries Identity error descriptions.
        foreach (var failure in new[] { missingUser, badToken, weakPassword })
        {
            failure.Body.Should().Contain("\"error\":\"INVALID_RESET_REQUEST\"");
            failure.Body.Should().NotContain("\"errors\"",
                "the verbose Identity errors[] array must never be returned — it was the enumeration oracle");
            failure.Body.Should().NotContainEquivalentOf("token",
                "Identity's \"Invalid token.\" description must not leak");
            failure.Body.Should().NotContainEquivalentOf("password",
                "Identity's password-policy descriptions must not leak");
        }
    }

    [Fact]
    public async Task A_fully_valid_reset_still_succeeds_after_the_oracle_fix()
    {
        var sender = new CapturingEmailSender();
        var client = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IEmailSender>();
                services.AddSingleton<IEmailSender>(sender);
            });
        }).CreateClient();

        var email = $"oracle-valid-{Guid.NewGuid():N}@example.com";
        (await client.PostAsJsonAsync("/api/auth/register", new
        {
            email,
            password = "Password123!",
            display_name = "Oracle Valid"
        })).EnsureSuccessStatusCode();

        (await client.PostAsJsonAsync("/api/auth/forgot-password", new { email }))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        var token = QueryHelpers.ParseQuery(new Uri(sender.ResetUrls.Single()).Query)["token"].Single();

        // Genuine success is the ONLY observably-different outcome: a 204 with no body.
        var reset = await client.PostAsJsonAsync("/api/auth/reset-password", new
        {
            email,
            token,
            password = "NewPassword123!"
        });
        reset.StatusCode.Should().Be(HttpStatusCode.NoContent);

        // And the new password actually works while the old one no longer does.
        (await client.PostAsJsonAsync("/api/auth/login", new { email, password = "Password123!" }))
            .StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await client.PostAsJsonAsync("/api/auth/login", new { email, password = "NewPassword123!" }))
            .StatusCode.Should().Be(HttpStatusCode.OK);
    }

    private static async Task<FailureResponse> ReadResponse(HttpResponseMessage response) =>
        new(response.StatusCode, await response.Content.ReadAsStringAsync());

    private readonly record struct FailureResponse(HttpStatusCode Status, string Body);

    private sealed class CapturingEmailSender : IEmailSender
    {
        public List<string> ResetUrls { get; } = [];

        public Task SendPasswordResetAsync(string email, string resetUrl, CancellationToken ct = default)
        {
            ResetUrls.Add(resetUrl);
            return Task.CompletedTask;
        }
    }
}
