using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Options;

namespace Sheshi.Api.Storage;

public class S3ImageStorage(
    IOptions<StorageOptions> options,
    IOptions<ImageSafetyOptions> imageSafetyOptions,
    IAmazonS3 s3) : IImageStorage
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

        await using var upload = new MemoryStream(sanitized);
        await s3.PutObjectAsync(new PutObjectRequest
        {
            BucketName = _options.S3.Bucket,
            Key = fileName,
            InputStream = upload,
            ContentType = contentType,
            AutoCloseStream = false
        }, ct);

        return $"{_options.PublicBaseUrl.TrimEnd('/')}/{fileName}";
    }
}
