using Microsoft.Extensions.Options;

namespace Sheshi.Api.Storage;

// Validates an uploaded video by its content-type allowlist + byte signature (so a renamed non-video
// can't slip through) and a size cap, then hands the bytes to the configured IBlobStore unchanged —
// videos aren't re-encoded (no ImageSharp equivalent). Backend-agnostic: same validation for the
// local-disk and S3 sinks. Served with the right extension so range requests (seeking) work.
public class VideoStorage(IOptions<StorageOptions> options, IBlobStore blobStore) : IVideoStorage
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

        var fileName = $"{Guid.NewGuid():N}{extension}";
        return await blobStore.PutAsync(bytes, fileName, contentType, ct);
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
