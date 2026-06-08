using FluentAssertions;

namespace Sheshi.Api.Tests;

public class EnvTemplateTests
{
    [Fact]
    public void Env_template_uses_compose_host_postgres_port()
    {
        var repoRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../.."));
        var envTemplate = File.ReadAllText(Path.Combine(repoRoot, ".env.example"));

        envTemplate.Should().Contain("ConnectionStrings__Default=Host=localhost;Port=55432;");
        envTemplate.Should().Contain("VITE_API_BASE_URL=http://localhost:5080");
        envTemplate.Should().Contain("Storage__PublicBaseUrl=http://localhost:5080/uploads");
        envTemplate.Should().Contain("Cors__AllowedOrigins=");
        envTemplate.Should().Contain("http://localhost:3001");
        envTemplate.Should().Contain("Frontend__BaseUrl=http://localhost:3001");
        envTemplate.Should().Contain("SeedAdmin__Email=");
        envTemplate.Should().NotContain("SUPABASE");
    }
}
