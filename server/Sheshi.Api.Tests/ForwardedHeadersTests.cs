using System.Net;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Sheshi.Api.Tests;

public class ForwardedHeadersTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task External_auth_uses_forwarded_https_scheme_when_proxy_headers_are_trusted()
    {
        var client = factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Proxy:TrustForwardedHeaders", "true");
            builder.UseSetting("Authentication:Google:ClientId", "client-id");
            builder.UseSetting("Authentication:Google:ClientSecret", "client-secret");
        }).CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false
        });

        var request = new HttpRequestMessage(HttpMethod.Get, "/api/auth/external/google");
        request.Headers.Add("X-Forwarded-Proto", "https");
        request.Headers.Add("X-Forwarded-Host", "api.sheshi.live");

        var response = await client.SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.Redirect);
        response.Headers.Location!.ToString().Should()
            .Contain("redirect_uri=https%3A%2F%2Fapi.sheshi.live%2Fsignin-google");
    }
}
