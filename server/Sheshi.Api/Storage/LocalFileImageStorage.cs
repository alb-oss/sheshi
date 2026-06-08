using Microsoft.Extensions.Options;

namespace Sheshi.Api.Storage;

public class LocalFileImageStorage(IOptions<StorageOptions> options) : IImageStorage
{
    private static readonly IReadOnlyDictionary<string, string> Extensions = new Dictionary<string, string>
    {
        ["image/jpeg"] = ".jpg",
        ["image/png"] = ".png",
        ["image/webp"] = ".webp"
    };

    private readonly StorageOptions _options = options.Value;

    public async Task<string> SaveAsync(Stream stream, string contentType, CancellationToken ct = default)
    {
        if (!Extensions.TryGetValue(contentType, out var extension))
            throw new ImageStorageException("UNSUPPORTED_IMAGE_TYPE");

        await using var buffer = new MemoryStream();
        await stream.CopyToAsync(buffer, ct);
        if (buffer.Length > _options.MaxBytes)
            throw new ImageStorageException("IMAGE_TOO_LARGE");

        Directory.CreateDirectory(_options.UploadPath);
        var fileName = $"{Guid.NewGuid():N}{extension}";
        var path = Path.Combine(_options.UploadPath, fileName);
        await File.WriteAllBytesAsync(path, buffer.ToArray(), ct);

        return $"{_options.PublicBaseUrl.TrimEnd('/')}/{fileName}";
    }
}
