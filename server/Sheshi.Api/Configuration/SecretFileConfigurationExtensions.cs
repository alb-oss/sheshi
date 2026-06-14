namespace Sheshi.Api.Configuration;

public static class SecretFileConfigurationExtensions
{
    public static string? GetSecretValue(this IConfiguration configuration, string key)
    {
        var fileKey = $"{key}File";
        var filePath = configuration[fileKey];
        if (!string.IsNullOrWhiteSpace(filePath))
        {
            var value = File.ReadAllText(filePath.Trim());
            return value.TrimEnd('\r', '\n');
        }

        var direct = configuration[key];
        return string.IsNullOrWhiteSpace(direct) ? null : direct;
    }

    public static string GetRequiredSecretValue(this IConfiguration configuration, string key)
    {
        var value = configuration.GetSecretValue(key);
        if (!string.IsNullOrWhiteSpace(value)) return value;

        throw new InvalidOperationException(
            $"Missing required configuration value '{key}' or '{key}File'.");
    }
}
