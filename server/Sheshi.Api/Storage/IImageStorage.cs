namespace Sheshi.Api.Storage;

public interface IImageStorage
{
    Task<string> SaveAsync(Stream stream, string contentType, CancellationToken ct = default);
}
