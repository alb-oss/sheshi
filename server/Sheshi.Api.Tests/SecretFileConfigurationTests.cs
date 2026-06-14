using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Sheshi.Api.Configuration;

namespace Sheshi.Api.Tests;

public class SecretFileConfigurationTests
{
    [Fact]
    public async Task GetSecretValue_prefers_file_when_file_key_is_set()
    {
        var path = Path.Combine(Path.GetTempPath(), $"sheshi-secret-{Guid.NewGuid():N}");
        await File.WriteAllTextAsync(path, "from-file\n");
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:SigningKey"] = "from-env",
                ["Jwt:SigningKeyFile"] = path
            })
            .Build();

        configuration.GetSecretValue("Jwt:SigningKey").Should().Be("from-file");
    }

    [Fact]
    public void GetSecretValue_uses_direct_value_when_file_key_is_empty()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Smtp:Password"] = "direct-secret",
                ["Smtp:PasswordFile"] = ""
            })
            .Build();

        configuration.GetSecretValue("Smtp:Password").Should().Be("direct-secret");
    }

    [Fact]
    public void GetRequiredSecretValue_throws_when_secret_is_missing()
    {
        var configuration = new ConfigurationBuilder().Build();

        var action = () => configuration.GetRequiredSecretValue("Jwt:SigningKey");

        action.Should().Throw<InvalidOperationException>()
            .WithMessage("Missing required configuration value 'Jwt:SigningKey' or 'Jwt:SigningKeyFile'.");
    }
}
