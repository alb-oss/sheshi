using Microsoft.Extensions.Options;

namespace Sheshi.Api.Storage;

// Writes validated bytes to the local uploads directory; the API serves them back via static-file
// middleware mapped at /uploads (see Program.cs). The default sink for local dev and single-box
// deploys. PublicBaseUrl is the prefix the frontend renders, so it must line up with that mapping.
public class LocalBlobStore(IOptions<StorageOptions> options) : IBlobStore
{
    private readonly StorageOptions _options = options.Value;

    public async Task<string> PutAsync(byte[] content, string fileName, string contentType, CancellationToken ct = default)
    {
        Directory.CreateDirectory(_options.UploadPath);
        await File.WriteAllBytesAsync(Path.Combine(_options.UploadPath, fileName), content, ct);
        return $"{_options.PublicBaseUrl.TrimEnd('/')}/{fileName}";
    }
}
