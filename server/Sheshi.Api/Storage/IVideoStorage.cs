namespace Sheshi.Api.Storage;

public interface IVideoStorage
{
    Task<string> SaveAsync(Stream stream, string contentType, CancellationToken ct = default);
}
