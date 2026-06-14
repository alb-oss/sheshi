namespace Sheshi.Api.Storage;

// The sink that persists already-validated upload bytes. Implementations differ only in *where* the
// bytes land (local disk vs S3-compatible object storage); all type/size/signature validation and
// image sanitization happens above this seam in ImageStorage/VideoStorage, so swapping the backend
// never duplicates the security-critical checks. Returns the public URL of the stored object.
public interface IBlobStore
{
    Task<string> PutAsync(byte[] content, string fileName, string contentType, CancellationToken ct = default);
}
