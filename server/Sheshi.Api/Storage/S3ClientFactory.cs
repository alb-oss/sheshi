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
}
