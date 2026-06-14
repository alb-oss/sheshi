using Microsoft.Extensions.Options;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.Formats.Png;
using SixLabors.ImageSharp.Formats.Webp;

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

        var sanitized = await SanitizeAsync(buffer.ToArray(), contentType, ct);

        var fileName = $"{Guid.NewGuid():N}{extension}";
        return await blobStore.PutAsync(sanitized, fileName, contentType, ct);
    }

    private async Task<byte[]> SanitizeAsync(byte[] bytes, string contentType, CancellationToken ct)
    {
        try
        {
            var detected = Image.DetectFormat(bytes);
            if (detected is null || !MatchesContentType(detected, contentType))
                throw new ImageStorageException("INVALID_IMAGE");

            using var image = Image.Load(bytes);
            var pixels = (long)image.Width * image.Height;
            if (image.Width <= 0 ||
                image.Height <= 0 ||
                image.Width > _imageSafety.MaxWidth ||
                image.Height > _imageSafety.MaxHeight ||
                pixels > _imageSafety.MaxPixels)
            {
                throw new ImageStorageException("IMAGE_DIMENSIONS_TOO_LARGE");
            }

            StripMetadata(image);

            await using var output = new MemoryStream();
            await SaveInClaimedFormatAsync(image, output, contentType, ct);
            if (output.Length > _options.MaxBytes)
                throw new ImageStorageException("IMAGE_TOO_LARGE");
            return output.ToArray();
        }
        catch (ImageStorageException)
        {
            throw;
        }
        catch (Exception ex) when (ex is InvalidImageContentException or UnknownImageFormatException or NotSupportedException)
        {
            throw new ImageStorageException("INVALID_IMAGE");
        }
    }

    private static bool MatchesContentType(IImageFormat format, string contentType) =>
        format.MimeTypes.Any(m => string.Equals(m, contentType, StringComparison.OrdinalIgnoreCase));

    private static void StripMetadata(Image image)
    {
        image.Metadata.ExifProfile = null;
        image.Metadata.XmpProfile = null;
        image.Metadata.IptcProfile = null;
        image.Metadata.IccProfile = null;
        foreach (var frame in image.Frames)
        {
            frame.Metadata.ExifProfile = null;
            frame.Metadata.XmpProfile = null;
            frame.Metadata.IptcProfile = null;
            frame.Metadata.IccProfile = null;
        }
    }

    private static Task SaveInClaimedFormatAsync(Image image, Stream output, string contentType, CancellationToken ct) =>
        contentType switch
        {
            "image/jpeg" => image.SaveAsJpegAsync(output, new JpegEncoder { Quality = 88, SkipMetadata = true }, ct),
            "image/png" => image.SaveAsPngAsync(output, new PngEncoder { SkipMetadata = true }, ct),
            "image/webp" => image.SaveAsWebpAsync(output, new WebpEncoder { Quality = 90, SkipMetadata = true }, ct),
            _ => throw new ImageStorageException("UNSUPPORTED_IMAGE_TYPE")
        };
}
