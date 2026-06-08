using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
namespace Sheshi.Api.Data;

/// <summary>
/// Used by `dotnet ef` at design time so the tools can construct an
/// <see cref="AppDbContext"/> without booting the full application host.
/// </summary>
public class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args)
    {
        var connectionString =
            Environment.GetEnvironmentVariable("ConnectionStrings__Default")
            ?? "Host=localhost;Port=55432;Database=sheshi;Username=sheshi;Password=sheshi";

        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(connectionString)
            .Options;

        return new AppDbContext(options);
    }
}
