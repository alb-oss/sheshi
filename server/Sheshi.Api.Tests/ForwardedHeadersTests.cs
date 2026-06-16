using System.Net;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

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

    [Fact]
    public void Forwarded_headers_trust_a_pinned_proxy_network_not_every_source()
    {
        var options = factory.Services.GetRequiredService<IOptions<ForwardedHeadersOptions>>().Value;

        // Regression for the .Clear()/.Clear() footgun: an EMPTY KnownIPNetworks puts the middleware in
        // trust-every-source mode, letting any client spoof X-Forwarded-For and defeat the per-IP rate
        // limits. The list must be populated with the trusted proxy network (the Docker bridge by
        // default), and ForwardLimit capped to 1 so only the single hop the proxy appended is consumed.
        options.KnownIPNetworks.Should().NotBeEmpty(
            "an empty allow-list trusts X-Forwarded-For from any source — the spoofing hole");
        options.ForwardLimit.Should().Be(1);
        options.KnownIPNetworks.Should().Contain(n =>
            n.BaseAddress.Equals(IPAddress.Parse("172.16.0.0")) && n.PrefixLength == 12);
    }
}
