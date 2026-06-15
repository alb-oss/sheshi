using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Options;

namespace Sheshi.Api.Storage;

// Persists validated bytes to S3-compatible object storage (MinIO locally, S3/R2 in prod) via a
// single PutObject. We do NOT set a per-object canned ACL: modern S3 buckets disable ACLs
// (Bucket Owner Enforced), so public read is granted by a bucket-level anonymous-download policy
// (set by the minio-init compose service), and PublicBaseUrl points at that public path.
public class S3BlobStore(IAmazonS3 s3, IOptions<StorageOptions> options) : IBlobStore
{
    private readonly StorageOptions _options = options.Value;

    public async Task<string> PutAsync(byte[] content, string fileName, string contentType, CancellationToken ct = default)
    {
        using var stream = new MemoryStream(content);
        var request = new PutObjectRequest
        {
            BucketName = _options.S3.Bucket,
            Key = fileName,
            InputStream = stream,
            ContentType = contentType,
        };
        // R2 doesn't implement chunked streaming payload signing; send UNSIGNED-PAYLOAD over HTTPS
        // instead (see S3ClientFactory.ShouldDisablePayloadSigning). Left off for plain-HTTP MinIO.
        if (S3ClientFactory.ShouldDisablePayloadSigning(_options.S3.Endpoint))
            request.DisablePayloadSigning = true;
        await s3.PutObjectAsync(request, ct);

        return $"{_options.PublicBaseUrl.TrimEnd('/')}/{fileName}";
    }
}
