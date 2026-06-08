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
    }
}
