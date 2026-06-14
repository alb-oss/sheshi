using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Testcontainers.PostgreSql;

namespace Sheshi.Api.Tests;

/// <summary>
/// Boots the API against a throwaway Postgres container. The app's startup
/// pipeline applies EF migrations and seeds roles/rooms automatically, so the
/// factory only needs to point the connection string at the container.
/// </summary>
public class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly PostgreSqlContainer _db = new PostgreSqlBuilder("postgres:17")
        .WithDatabase("sheshi")
        .WithUsername("sheshi")
        .WithPassword("sheshi")
        .Build();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.ConfigureAppConfiguration((_, config) =>
        {
            var uploadPath = Path.Combine(Path.GetTempPath(), $"sheshi-test-uploads-{Guid.NewGuid():N}");
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Default"] = _db.GetConnectionString(),
                ["Storage:UploadPath"] = uploadPath,
                ["Storage:PublicBaseUrl"] = "http://localhost:5080/uploads",
                ["Storage:MaxBytes"] = "20971520",
            });
        });
    }

    async Task IAsyncLifetime.InitializeAsync() => await _db.StartAsync();

    async Task IAsyncLifetime.DisposeAsync()
    {
        await base.DisposeAsync();
        await _db.DisposeAsync();
    }
}
