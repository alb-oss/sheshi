using System.Text.RegularExpressions;

namespace Sheshi.Api.Features.Users;

// Reddit-style anonymous handles, mostly-English word pairs (Albanian ones read a bit odd). Words are
// ASCII and short (adjective ≤6, noun ≤7) so every result satisfies the username rule [a-z0-9_]{3,20}.
// `Anonymous()` uses a hex suffix to stay unique without a registration retry loop; `Suggestion()`
// uses a friendlier number for the profile picker.
public static partial class UsernameGenerator
{
    // The single source of truth for a valid handle: lowercase letters, digits, underscore; 3–20
    // chars. Used at registration, on the profile editor, and to keep generated names conformant.
    [GeneratedRegex("^[a-z0-9_]{3,20}$")]
    private static partial Regex Pattern();

    public static bool IsValid(string username) => Pattern().IsMatch(username);

    private static readonly string[] Adjectives =
    [
        "brave", "quiet", "swift", "calm", "bold", "lucky", "witty", "noble", "eager", "keen",
        "wild", "fair", "clever", "happy", "sunny", "mighty",
    ];

    private static readonly string[] Nouns =
    [
        "falcon", "river", "eagle", "wolf", "bear", "fox", "owl", "raven", "maple", "cedar",
        "comet", "ember", "harbor", "meadow", "otter", "willow", "summit", "canyon", "hawk", "badger",
    ];

    // Unique-enough handle for registration (no email leak), e.g. "trim_mjegull_3f2a".
    public static string Anonymous() =>
        $"{Pick(Adjectives)}_{Pick(Nouns)}_{Guid.NewGuid().ToString("N")[..4]}";

    // Friendlier suggestion for the profile picker, e.g. "trim_mjegull_4821".
    public static string Suggestion() =>
        $"{Pick(Adjectives)}_{Pick(Nouns)}_{Random.Shared.Next(100, 10000)}";

    private static string Pick(string[] words) => words[Random.Shared.Next(words.Length)];
}
