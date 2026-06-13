using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Features.Moderation;

public class ModerationRuleEngine(AppDbContext db, IContentClassifier classifier)
{
    private static readonly Regex EmailRegex = new(
        @"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly Regex PhoneRegex = new(
        @"\b(?:\+?\d[\s.-]?){7,15}\b",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly Regex LinkRegex = new(
        @"https?://|www\.",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly Regex AddressHintRegex = new(
        @"\b\d{1,5}\s+[A-Z0-9.'-]+\s+(?:street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr)\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly Regex WhitespaceRegex = new(@"\s+", RegexOptions.Compiled);
    private static readonly Regex RuleTokenRegex = new(
        @"[^a-z0-9._-]+",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private const int DuplicateThreshold = 3;
    private const int LinkBurstThreshold = 3;
    private const int MessageBurstThreshold = 8;
    private static readonly TimeSpan RecentWindow = TimeSpan.FromMinutes(10);

    public async Task<IReadOnlyList<ModerationFlag>> EvaluateAsync(Message message, CancellationToken ct = default)
    {
        var candidates = new List<FlagCandidate>();
        AddPiiCandidates(message.Body, candidates);
        await AddSpamCandidatesAsync(message, candidates, ct);
        await AddClassifierCandidatesAsync(message.Body, candidates, ct);

        if (candidates.Count == 0) return [];

        var ruleKeys = candidates.Select(c => c.RuleKey).Distinct().ToArray();
        var existingRuleKeys = await db.ModerationFlags
            .Where(f => f.MessageId == message.Id && ruleKeys.Contains(f.RuleKey))
            .Select(f => f.RuleKey)
            .ToListAsync(ct);

        var existing = existingRuleKeys.ToHashSet(StringComparer.Ordinal);
        var flags = candidates
            .Where(c => !existing.Contains(c.RuleKey))
            .GroupBy(c => c.RuleKey)
            .Select(g => ToFlag(message, g.First()))
            .ToList();

        if (flags.Count == 0) return [];

        db.ModerationFlags.AddRange(flags);
        await db.SaveChangesAsync(ct);
        return flags;
    }

    private static void AddPiiCandidates(string body, ICollection<FlagCandidate> candidates)
    {
        if (EmailRegex.IsMatch(body))
        {
            candidates.Add(new FlagCandidate(
                "doxxing.email",
                ModerationCategory.Doxxing,
                ModerationSeverity.High,
                0.95,
                "email-like value detected: [redacted-email]"));
        }

        if (PhoneRegex.IsMatch(body))
        {
            candidates.Add(new FlagCandidate(
                "doxxing.phone",
                ModerationCategory.Doxxing,
                ModerationSeverity.High,
                0.9,
                "phone-like value detected: [redacted-phone]"));
        }

        if (AddressHintRegex.IsMatch(body))
        {
            candidates.Add(new FlagCandidate(
                "doxxing.address_hint",
                ModerationCategory.Doxxing,
                ModerationSeverity.Medium,
                0.75,
                "address-like value detected: [redacted-address]"));
        }
    }

    private async Task AddSpamCandidatesAsync(Message message, ICollection<FlagCandidate> candidates, CancellationToken ct)
    {
        var body = Normalize(message.Body);
        if (body.Length == 0) return;

        var since = message.CreatedAt.Subtract(RecentWindow);
        var recentMessages = await db.Messages
            .AsNoTracking()
            .Where(m =>
                m.AuthorId == message.AuthorId &&
                m.CreatedAt >= since &&
                m.CreatedAt <= message.CreatedAt &&
                m.DeletedAt == null)
            .Select(m => new { m.Body })
            .ToListAsync(ct);

        var duplicateCount = recentMessages.Count(m => Normalize(m.Body) == body);
        if (duplicateCount >= DuplicateThreshold)
        {
            candidates.Add(new FlagCandidate(
                "spam.duplicate_text",
                ModerationCategory.Spam,
                ModerationSeverity.Medium,
                0.82,
                $"same normalized text repeated {duplicateCount} times in 10 minutes"));
        }

        var linkCount = recentMessages.Count(m => LinkRegex.IsMatch(m.Body));
        if (LinkRegex.IsMatch(message.Body) && linkCount >= LinkBurstThreshold)
        {
            candidates.Add(new FlagCandidate(
                "spam.link_burst",
                ModerationCategory.Spam,
                ModerationSeverity.Medium,
                0.78,
                $"{linkCount} link-heavy messages in 10 minutes"));
        }

        if (recentMessages.Count >= MessageBurstThreshold)
        {
            candidates.Add(new FlagCandidate(
                "spam.too_many_messages",
                ModerationCategory.Spam,
                ModerationSeverity.Low,
                0.7,
                $"{recentMessages.Count} messages in 10 minutes"));
        }
    }

    private async Task AddClassifierCandidatesAsync(string body, ICollection<FlagCandidate> candidates, CancellationToken ct)
    {
        var results = await classifier.ClassifyAsync(body, ct);
        foreach (var result in results.Where(r => r.Score > 0))
        {
            var categoryKey = NormalizeRuleToken(result.Category, "other");
            var category = Enum.TryParse<ModerationCategory>(result.Category, ignoreCase: true, out var parsedCategory)
                ? parsedCategory
                : ModerationCategory.Other;
            var severity = Enum.TryParse<ModerationSeverity>(result.Severity, ignoreCase: true, out var parsedSeverity)
                ? parsedSeverity
                : ModerationSeverity.Medium;

            candidates.Add(new FlagCandidate(
                TrimTo($"classifier.{categoryKey}", 120),
                category,
                severity,
                Math.Clamp(result.Score, 0, 1),
                TrimTo(string.IsNullOrWhiteSpace(result.Evidence) ? "classifier signal" : result.Evidence.Trim(), 500)));
        }
    }

    private static ModerationFlag ToFlag(Message message, FlagCandidate candidate) => new()
    {
        MessageId = message.Id,
        RoomId = message.RoomId,
        AuthorId = message.AuthorId,
        RuleKey = candidate.RuleKey,
        Category = candidate.Category,
        Severity = candidate.Severity,
        Score = candidate.Score,
        Evidence = candidate.Evidence
    };

    private static string Normalize(string value) =>
        WhitespaceRegex.Replace(value.Trim().ToLowerInvariant(), " ");

    private static string NormalizeRuleToken(string value, string fallback)
    {
        var normalized = RuleTokenRegex.Replace(value.Trim().ToLowerInvariant(), "_").Trim('_');
        return normalized.Length == 0 ? fallback : normalized;
    }

    private static string TrimTo(string value, int maxLength) =>
        value.Length <= maxLength ? value : value[..maxLength];

    private sealed record FlagCandidate(
        string RuleKey,
        ModerationCategory Category,
        ModerationSeverity Severity,
        double Score,
        string Evidence);
}
