using System.Net;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;

namespace Sheshi.Api.Tests;

// Isolated from the rest of the suite: the "reads" limiter is partitioned by IP and all test clients
// share 127.0.0.1, so tripping it must happen on a dedicated host (its own ApiFactory fixture) that no
// other test class shares. We override the limit low via WithWebHostBuilder so the assertion is fast
// and deterministic rather than flooding the default 100/window.
public class ReadRateLimitTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Anonymous_reads_are_rate_limited_with_429()
    {
        var client = factory.WithWebHostBuilder(builder =>
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["RateLimits:Reads:PermitLimit"] = "3",
                    ["RateLimits:Reads:WindowSeconds"] = "60",
                }))).CreateClient();

        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 5; i++)
            statuses.Add((await client.GetAsync("/api/rooms")).StatusCode);

        statuses.Take(3).Should().OnlyContain(s => s == HttpStatusCode.OK,
            "the first 3 reads are within the per-IP budget");
        statuses.Should().Contain(HttpStatusCode.TooManyRequests,
            "reads past the limit must be rejected with 429, not served");
    }
}
