namespace Sheshi.Api.Domain;

public static class Text
{
    /// <summary>Trims and caps user-supplied text; empty input becomes null.</summary>
    public static string? Clip(string? value, int maxLength)
    {
        value = value?.Trim();
        if (string.IsNullOrEmpty(value)) return null;
        return value.Length <= maxLength ? value : value[..maxLength];
    }
}
