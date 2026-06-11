using System.Net;
using FluentAssertions;

namespace Sheshi.Api.Tests;

public class SmokeTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Liveness_returns_healthy()
    {
        var client = factory.CreateClient();

        var response = await client.GetAsync("/health");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.Content.ReadAsStringAsync()).Should().Be("Healthy");
    }

    [Fact]
    public async Task Readiness_reports_database_reachable()
    {
        var client = factory.CreateClient();

        var response = await client.GetAsync("/health/ready");

        // The test fixture runs against a live Postgres container, so readiness passes.
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.Content.ReadAsStringAsync()).Should().Be("Healthy");
    }
}
