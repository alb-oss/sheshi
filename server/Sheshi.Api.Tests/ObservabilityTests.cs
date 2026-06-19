using System.Net;
using FluentAssertions;

namespace Sheshi.Api.Tests;

/// <summary>
/// Observability wiring (ADR 2026-06-18): Serilog structured JSON logging is always on, with no
/// third-party dependency (logs go to stdout for Docker/journald to capture). This asserts the app
/// boots and serves a request through the Serilog request-logging pipeline.
/// </summary>
public class ObservabilityTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Boots_and_serves_through_the_serilog_pipeline()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }
}
