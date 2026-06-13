namespace Sheshi.Api.Features.Moderation;

public interface IContentClassifier
{
    Task<IReadOnlyList<ContentClassificationResult>> ClassifyAsync(string text, CancellationToken ct = default);
}

public record ContentClassificationResult(
    string Category,
    string Severity,
    double Score,
    string Evidence);
