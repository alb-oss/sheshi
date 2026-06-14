using Microsoft.Extensions.Options;

namespace Sheshi.Api.Storage;

// Videos can't be cheaply re-encoded like images (no ImageSharp equivalent), so we validate the
// container by its content-type allowlist + byte signature (so a renamed non-video can't slip
// through) and a size cap, then store the bytes as-is. Served as a static file with the right
// extension; Kestrel handles HTTP range requests for seeking.
public class LocalFileVideoStorage(IOptions<StorageOptions> options) : IVideoStorage
{
    private static readonly IReadOnlyDictionary<string, string> Extensions = new Dictionary<string, string>
    {
        ["video/mp4"] = ".mp4",
        ["video/quicktime"] = ".mov",
        ["video/webm"] = ".webm",
    };

    private readonly StorageOptions _options = options.Value;

    public async Task<string> SaveAsync(Stream stream, string contentType, CancellationToken ct = default)
    {
        contentType = contentType.Trim().ToLowerInvariant();
        if (!Extensions.TryGetValue(contentType, out var extension))
            throw new ImageStorageException("UNSUPPORTED_VIDEO_TYPE");

        await using var buffer = new MemoryStream();
        await stream.CopyToAsync(buffer, ct);
        var bytes = buffer.ToArray();

        if (bytes.Length == 0) throw new ImageStorageException("INVALID_VIDEO");
        if (bytes.Length > _options.MaxVideoBytes) throw new ImageStorageException("VIDEO_TOO_LARGE");
        if (!MatchesSignature(bytes, contentType)) throw new ImageStorageException("INVALID_VIDEO");

        Directory.CreateDirectory(_options.UploadPath);
        var fileName = $"{Guid.NewGuid():N}{extension}";
        await File.WriteAllBytesAsync(Path.Combine(_options.UploadPath, fileName), bytes, ct);
        return $"{_options.PublicBaseUrl.TrimEnd('/')}/{fileName}";
    }

    private static bool MatchesSignature(byte[] b, string contentType)
    {
        // WebM/Matroska: EBML header magic.
        if (contentType == "video/webm")
            return b.Length >= 4 && b[0] == 0x1A && b[1] == 0x45 && b[2] == 0xDF && b[3] == 0xA3;
        // mp4 / mov: ISO Base Media File Format — a "ftyp" box right after the 4-byte box size.
        return b.Length >= 12 && b[4] == (byte)'f' && b[5] == (byte)'t' && b[6] == (byte)'y' && b[7] == (byte)'p';
    }
}
