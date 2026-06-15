using Amazon.Runtime;
using Amazon.S3;

namespace Sheshi.Api.Storage;

// Builds the AmazonS3Config for the S3-compatible sink. Kept as a pure, testable factory because the
// checksum settings below are load-bearing: AWS SDK for .NET v4 defaults RequestChecksumCalculation to
// WHEN_SUPPORTED, which sends every PutObject with a CRC32 checksum via aws-chunked/trailer encoding.
// Cloudflare R2 (our prod object store) rejects that trailer, so uploads throw and 500. Forcing
// WHEN_REQUIRED restores the pre-v4 behaviour R2 (and other strict S3-compatibles) accept; MinIO/S3 are
// unaffected. A unit test pins these so an SDK bump can't silently re-break prod uploads.
public static class S3ClientFactory
{
    public static AmazonS3Config BuildConfig(S3StorageOptions s3)
    {
        var config = new AmazonS3Config
        {
            ForcePathStyle = s3.ForcePathStyle,
            AuthenticationRegion = string.IsNullOrWhiteSpace(s3.Region) ? "us-east-1" : s3.Region,
            RequestChecksumCalculation = RequestChecksumCalculation.WHEN_REQUIRED,
            ResponseChecksumValidation = ResponseChecksumValidation.WHEN_REQUIRED,
        };
        if (!string.IsNullOrWhiteSpace(s3.Endpoint)) config.ServiceURL = s3.Endpoint;
        return config;
    }

    // AWS SDK v4 signs the PutObject body with chunked streaming signing
    // (STREAMING-AWS4-HMAC-SHA256-PAYLOAD), which Cloudflare R2 does not implement ("not implemented" →
    // 500). Sending an UNSIGNED-PAYLOAD (DisablePayloadSigning) sidesteps it, but the SDK only allows
    // that over HTTPS (TLS provides integrity). So disable payload signing for HTTPS endpoints (R2, and
    // real AWS S3 when no endpoint is set) and leave it on for plain-HTTP endpoints like local MinIO,
    // which implement chunked signing fine.
    public static bool ShouldDisablePayloadSigning(string? endpoint)
        => string.IsNullOrWhiteSpace(endpoint)
            || endpoint.Trim().StartsWith("https://", StringComparison.OrdinalIgnoreCase);
}
