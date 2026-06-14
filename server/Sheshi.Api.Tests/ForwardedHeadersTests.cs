using System.Net;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Sheshi.Api.Tests;

public class ForwardedHeadersTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task External_auth_uses_forwarded_https_scheme_when_proxy_headers_are_trusted()
    {
        Environment.SetEnvironmentVariable("Proxy__TrustForwardedHeaders", "true");
        Environment.SetEnvironmentVariable("Authentication__Google__ClientId", "client-id");
        Environment.SetEnvironmentVariable("Authentication__Google__ClientSecret", "client-secret");
        try
        {
            var client = factory.CreateClient(new WebApplicationFactoryClientOptions
            {
                AllowAutoRedirect = false
            });

            var request = new HttpRequestMessage(HttpMethod.Get, "/api/auth/external/google");
            request.Headers.Add("X-Forwarded-Proto", "https");
            request.Headers.Add("X-Forwarded-Host", "api.sheshi.al");

            var response = await client.SendAsync(request);

            response.StatusCode.Should().Be(HttpStatusCode.Redirect);
            response.Headers.Location!.ToString().Should()
                .Contain("redirect_uri=https%3A%2F%2Fapi.sheshi.al%2Fsignin-google");
        }
        finally
        {
            Environment.SetEnvironmentVariable("Proxy__TrustForwardedHeaders", null);
            Environment.SetEnvironmentVariable("Authentication__Google__ClientId", null);
            Environment.SetEnvironmentVariable("Authentication__Google__ClientSecret", null);
        }
    }
}
