using Amazon.Runtime;
using FluentAssertions;
using Sheshi.Api.Storage;

namespace Sheshi.Api.Tests;

public class S3ClientFactoryTests
{
    // Cloudflare R2 rejects the CRC32 trailer AWS SDK v4 adds by default; these must stay WHEN_REQUIRED
    // or every prod upload 500s again.
    [Fact]
    public void BuildConfig_disables_default_request_checksums_for_r2_compatibility()
    {
        var config = S3ClientFactory.BuildConfig(new S3StorageOptions
        {
            Endpoint = "https://acc.r2.cloudflarestorage.com",
            Region = "auto",
            ForcePathStyle = true,
        });

        config.RequestChecksumCalculation.Should().Be(RequestChecksumCalculation.WHEN_REQUIRED);
        config.ResponseChecksumValidation.Should().Be(ResponseChecksumValidation.WHEN_REQUIRED);
        config.ForcePathStyle.Should().BeTrue();
        config.AuthenticationRegion.Should().Be("auto");
        // The SDK normalises ServiceURL (trailing slash), so assert the endpoint is carried, not exact.
        config.ServiceURL.Should().StartWith("https://acc.r2.cloudflarestorage.com");
    }

    [Fact]
    public void BuildConfig_defaults_region_when_unset()
    {
        var config = S3ClientFactory.BuildConfig(new S3StorageOptions { Region = "" });
        config.AuthenticationRegion.Should().Be("us-east-1");
    }
}
