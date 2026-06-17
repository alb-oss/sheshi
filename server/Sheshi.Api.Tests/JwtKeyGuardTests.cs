using System.Net;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;

namespace Sheshi.Api.Tests;

/// <summary>
/// Regression guard for FINDING 9: a non-Development host must refuse to boot with the dev
/// placeholder JWT signing key committed in appsettings.json. Without the guard, flipping
/// ASPNETCORE_ENVIRONMENT to Production without wiring the Jwt__SigningKeyFile Docker secret
/// would silently sign tokens with a repo-known HMAC key (anyone could mint admin JWTs).
/// </summary>
public class JwtKeyGuardTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    // The exact value committed in server/Sheshi.Api/appsettings.json under Jwt:SigningKey.
    private const string DevPlaceholderSigningKey = "local_dev_signing_key_change_me_min_32_bytes";

    [Fact]
    public void Production_with_dev_placeholder_signing_key_fails_to_start()
    {
        using var app = factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Production");
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Jwt:SigningKey"] = DevPlaceholderSigningKey,
                });
            });
        });

        // Building the host (triggered by touching Services) must throw before the app ever runs.
        var boot = () => _ = app.Services;

        boot.Should().Throw<InvalidOperationException>()
            // Security-relevant fragment: it refuses to start, and it never echoes the key value.
            .Which.Message.Should()
            .Contain("Refusing to start").And
            .NotContain(DevPlaceholderSigningKey);
    }

    [Fact]
    public void Production_with_a_distinct_strong_key_passes_the_guard()
    {
        // The guard reads Jwt:SigningKey at BUILD time (top-level Program.cs), before
        // WebApplicationFactory layers its ConfigureAppConfiguration — so an in-memory override there
        // never wins. Inject via an env var, which WebApplication.CreateBuilder reads immediately
        // (Jwt__SigningKey -> Jwt:SigningKey). A strong key must NOT trip the guard (no false positive).
        const string strongKey =
            "prod_strong_signing_key_definitely_not_the_dev_placeholder_value_0123456789";
        var previous = Environment.GetEnvironmentVariable("Jwt__SigningKey");
        Environment.SetEnvironmentVariable("Jwt__SigningKey", strongKey);
        try
        {
            using var app = factory.WithWebHostBuilder(builder => builder.UseEnvironment("Production"));
            // Touching Services builds the host and runs the top-level guard; a strong key builds cleanly.
            var build = () => _ = app.Services;
            build.Should().NotThrow<InvalidOperationException>();
        }
        finally
        {
            Environment.SetEnvironmentVariable("Jwt__SigningKey", previous);
        }
    }

    [Fact]
    public async Task Development_with_the_dev_placeholder_key_still_boots()
    {
        // The base factory runs in Development and falls back to the committed dev placeholder key;
        // the guard must leave Development untouched.
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }
}
