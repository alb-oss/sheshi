using System.Text.RegularExpressions;

namespace Sheshi.Api.Common;

public static partial class Slug
{
    /// <summary>
    /// Normalizes free text into a URL slug: lowercased, leading '#' stripped,
    /// non-alphanumeric runs collapsed to '-', trimmed and capped at 60 chars.
    /// Returns null when nothing usable remains.
    /// </summary>
    public static string? Normalize(string? value)
    {
        value = value?.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(value)) return null;
        value = LeadingHashes().Replace(value, "");
        value = NonAlphanumeric().Replace(value, "-").Trim('-');
        return string.IsNullOrWhiteSpace(value) ? null : value[..Math.Min(value.Length, 60)];
    }

    [GeneratedRegex("^#+")]
    private static partial Regex LeadingHashes();

    [GeneratedRegex("[^a-z0-9]+")]
    private static partial Regex NonAlphanumeric();
}
