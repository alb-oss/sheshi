using FluentAssertions;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Tests;

public class SeedAdminTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Startup_seed_creates_configured_admin_account()
    {
        var email = $"admin-{Guid.NewGuid():N}@example.com";
        var app = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["SeedAdmin:Email"] = email,
                    ["SeedAdmin:Password"] = "AdminPassword123!",
                    ["SeedAdmin:DisplayName"] = "Local Admin"
                });
            });
        });

        using var client = app.CreateClient();
        (await client.GetAsync("/health")).EnsureSuccessStatusCode();

        using var scope = app.Services.CreateScope();
        var userManager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var user = await userManager.FindByEmailAsync(email);

        user.Should().NotBeNull();
        user!.DisplayName.Should().Be("Local Admin");
        (await userManager.IsInRoleAsync(user, Roles.User)).Should().BeTrue();
        (await userManager.IsInRoleAsync(user, Roles.Admin)).Should().BeTrue();
        (await userManager.CheckPasswordAsync(user, "AdminPassword123!")).Should().BeTrue();
    }
}
