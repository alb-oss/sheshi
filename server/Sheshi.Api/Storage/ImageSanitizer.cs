using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.Formats.Png;
using SixLabors.ImageSharp.Formats.Webp;

namespace Sheshi.Api.Storage;

public class ImageSanitizer
{
    private readonly ImageSafetyOptions _imageSafety;
    private readonly long _maxBytes;

    public ImageSanitizer(ImageSafetyOptions imageSafety, long maxBytes)
    {
        _imageSafety = imageSafety;
        _maxBytes = maxBytes;
    }

    public async Task<byte[]> SanitizeAsync(byte[] bytes, string contentType, CancellationToken ct)
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
            if (output.Length > _maxBytes)
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
