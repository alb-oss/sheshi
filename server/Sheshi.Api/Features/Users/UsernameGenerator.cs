namespace Sheshi.Api.Features.Users;

// Reddit-style anonymous handles, Albanian-flavored. Words are deliberately ASCII (no ë/ç) so every
// result satisfies the username rule [a-z0-9_]{3,20}. `Anonymous()` uses a hex suffix to stay unique
// without a registration retry loop; `Suggestion()` uses a friendlier number for the profile picker.
public static class UsernameGenerator
{
    private static readonly string[] Adjectives =
    [
        "trim", "qeta", "bardh", "kuq", "plak", "shpejt", "zgjuar", "larte", "forte", "lire",
        "mencur", "gjalle",
    ];

    private static readonly string[] Nouns =
    [
        "mjegull", "shqipe", "lumi", "mali", "dielli", "hena", "zogu", "ujku", "ariu", "gjeli",
        "qielli", "deti", "era", "bora", "ylli", "pylli",
    ];

    // Unique-enough handle for registration (no email leak), e.g. "trim_mjegull_3f2a".
    public static string Anonymous() =>
        $"{Pick(Adjectives)}_{Pick(Nouns)}_{Guid.NewGuid().ToString("N")[..4]}";

    // Friendlier suggestion for the profile picker, e.g. "trim_mjegull_4821".
    public static string Suggestion() =>
        $"{Pick(Adjectives)}_{Pick(Nouns)}_{Random.Shared.Next(100, 10000)}";

    private static string Pick(string[] words) => words[Random.Shared.Next(words.Length)];
}
