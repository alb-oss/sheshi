using System.Net;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;

namespace Sheshi.Api.Tests;

/// <summary>
/// Observability wiring (ADR 2026-06-18): Serilog structured logging is always on; Sentry is DSN-gated.
/// These assert the app boots and serves through the new pipeline both WITHOUT a DSN (the dev/test/
/// unconfigured-prod default — Sentry is never initialised, so startup can't depend on it) and WITH one
/// (UseSentry initialises cleanly). Sentry:Dsn is resolved at builder time, before WebApplicationFactory
/// layers its config, so the with-DSN case injects it via an env var (Sentry__Dsn).
/// </summary>
public class ObservabilityTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Boots_and_serves_with_serilog_and_no_sentry_dsn()
    {
        // Base factory runs with an empty Sentry DSN — Sentry is never wired; Serilog request logging is.
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Boots_and_serves_with_a_sentry_dsn_configured()
    {
        // A well-formed DSN must initialise UseSentry without breaking startup; a /health GET sends no
        // events. Injected via env var because Sentry:Dsn is read at builder time (Sentry__Dsn -> Sentry:Dsn).
        const string dummyDsn = "https://0123456789abcdef0123456789abcdef@o0.ingest.sentry.io/0";
        var previous = Environment.GetEnvironmentVariable("Sentry__Dsn");
        Environment.SetEnvironmentVariable("Sentry__Dsn", dummyDsn);
        try
        {
            using var app = factory.WithWebHostBuilder(_ => { });
            using var client = app.CreateClient();

            var response = await client.GetAsync("/health");

            response.StatusCode.Should().Be(HttpStatusCode.OK);
        }
        finally
        {
            Environment.SetEnvironmentVariable("Sentry__Dsn", previous);
        }
    }
}
