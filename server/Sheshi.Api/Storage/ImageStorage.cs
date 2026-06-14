using Microsoft.Extensions.Options;

namespace Sheshi.Api.Storage;

// Validates + sanitizes an uploaded image (content-type allowlist, size cap, and an ImageSharp
// re-encode that strips metadata and drops any trailing payload — the security-critical step), then
// hands the clean bytes to the configured IBlobStore. Backend-agnostic: the exact same validation
// runs whether the sink writes to local disk or to S3-compatible object storage.
public class ImageStorage(
    IOptions<StorageOptions> options,
    IOptions<ImageSafetyOptions> imageSafetyOptions,
    IBlobStore blobStore) : IImageStorage
{
    private static readonly IReadOnlyDictionary<string, string> Extensions = new Dictionary<string, string>
    {
        ["image/jpeg"] = ".jpg",
        ["image/png"] = ".png",
        ["image/webp"] = ".webp"
    };

    private readonly StorageOptions _options = options.Value;
    private readonly ImageSafetyOptions _imageSafety = imageSafetyOptions.Value;

    public async Task<string> SaveAsync(Stream stream, string contentType, CancellationToken ct = default)
    {
        contentType = contentType.Trim().ToLowerInvariant();
        if (!Extensions.TryGetValue(contentType, out var extension))
            throw new ImageStorageException("UNSUPPORTED_IMAGE_TYPE");

        await using var buffer = new MemoryStream();
        await stream.CopyToAsync(buffer, ct);
        if (buffer.Length > _options.MaxBytes)
            throw new ImageStorageException("IMAGE_TOO_LARGE");

        var sanitizer = new ImageSanitizer(_imageSafety, _options.MaxBytes);
        var sanitized = await sanitizer.SanitizeAsync(buffer.ToArray(), contentType, ct);

        var fileName = $"{Guid.NewGuid():N}{extension}";
        return await blobStore.PutAsync(sanitized, fileName, contentType, ct);
    }
}
