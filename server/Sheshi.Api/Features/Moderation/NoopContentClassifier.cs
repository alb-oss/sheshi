namespace Sheshi.Api.Features.Moderation;

public class NoopContentClassifier : IContentClassifier
{
    public Task<IReadOnlyList<ContentClassificationResult>> ClassifyAsync(string text, CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<ContentClassificationResult>>([]);
}
