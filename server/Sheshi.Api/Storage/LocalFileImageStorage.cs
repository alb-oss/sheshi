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
                var headerChecked = false;
                while ((read = await stream.ReadAsync(buffer, ct)) > 0)
                {
                    if (!headerChecked)
                    {
                        // The Content-Type header is attacker-controlled; trust
                        // the file's magic bytes, not the label.
                        if (!HasValidSignature(buffer, read, contentType))
                            throw new ImageStorageException("INVALID_IMAGE");
                        headerChecked = true;
                    }

                    total += read;
                    if (total > _options.MaxBytes)
                        throw new ImageStorageException("IMAGE_TOO_LARGE");

                    await file.WriteAsync(buffer.AsMemory(0, read), ct);
                }

                if (!headerChecked) throw new ImageStorageException("INVALID_IMAGE");
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

    private static bool HasValidSignature(byte[] buffer, int count, string contentType) => contentType switch
    {
        "image/jpeg" => count >= 3 && buffer[0] == 0xFF && buffer[1] == 0xD8 && buffer[2] == 0xFF,
        "image/png" => count >= 8 &&
                       buffer[0] == 0x89 && buffer[1] == 0x50 && buffer[2] == 0x4E && buffer[3] == 0x47 &&
                       buffer[4] == 0x0D && buffer[5] == 0x0A && buffer[6] == 0x1A && buffer[7] == 0x0A,
        "image/webp" => count >= 12 &&
                        buffer[0] == (byte)'R' && buffer[1] == (byte)'I' && buffer[2] == (byte)'F' && buffer[3] == (byte)'F' &&
                        buffer[8] == (byte)'W' && buffer[9] == (byte)'E' && buffer[10] == (byte)'B' && buffer[11] == (byte)'P',
        _ => false
    };
}
