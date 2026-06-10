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

        Directory.CreateDirectory(_options.UploadPath);
        var fileName = $"{Guid.NewGuid():N}{extension}";
        var path = Path.Combine(_options.UploadPath, fileName);
        var tempPath = $"{path}.tmp";

        try
        {
            {
                await using var file = new FileStream(
                    tempPath,
                    FileMode.CreateNew,
                    FileAccess.Write,
                    FileShare.None,
                    bufferSize: 81920,
                    useAsync: true);

                var buffer = new byte[81920];
                long total = 0;
                int read;
                while ((read = await stream.ReadAsync(buffer, ct)) > 0)
                {
                    total += read;
                    if (total > _options.MaxBytes)
                        throw new ImageStorageException("IMAGE_TOO_LARGE");

                    await file.WriteAsync(buffer.AsMemory(0, read), ct);
                }
            }

            File.Move(tempPath, path);
        }
        catch
        {
            if (File.Exists(tempPath)) File.Delete(tempPath);
            throw;
        }

        return $"{_options.PublicBaseUrl.TrimEnd('/')}/{fileName}";
    }
}
