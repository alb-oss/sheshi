using System.Net;
using FluentAssertions;

namespace Sheshi.Api.Tests;

public class CorsTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Api_allows_frontend_dev_origin_on_localhost_3001()
    {
        var client = factory.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Options, "/api/rooms");
        request.Headers.Add("Origin", "http://localhost:3001");
        request.Headers.Add("Access-Control-Request-Method", "GET");

        var response = await client.SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        response.Headers.GetValues("Access-Control-Allow-Origin").Should().Contain("http://localhost:3001");
    }
}
