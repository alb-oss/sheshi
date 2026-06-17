using FluentAssertions;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Png;
using SixLabors.ImageSharp.PixelFormats;
using Sheshi.Api.Storage;

namespace Sheshi.Api.Tests;

// Regression test for FINDING 8: the sanitizer must reject an oversized image from its header
// metadata (Image.Identify) BEFORE the full Image.Load decode, so a decompression-bomb image is
// turned away without materialising its pixel buffer. The assertion pins the rejection to the same
// IMAGE_DIMENSIONS_TOO_LARGE contract the post-decode check has always thrown, and uses limits small
// enough that the trip-wire image stays cheap to allocate in the test itself.
public class ImageSanitizerDimensionTests
{
    [Fact]
    public async Task SanitizeAsync_rejects_image_whose_dimensions_exceed_max_width()
    {
        var safety = new ImageSafetyOptions
        {
            MaxWidth = 16,
            MaxHeight = 16,
            MaxPixels = 256,
            MaxDimension = 16
        };
        var sanitizer = new ImageSanitizer(safety, maxBytes: 20 * 1024 * 1024);

        // 64x4 PNG: width (64) > MaxWidth (16). The header alone is enough to know this is over the
        // limit, so the metadata pre-check must reject it before the full decode.
        var oversized = CreatePng(width: 64, height: 4);

        var act = () => sanitizer.SanitizeAsync(oversized, "image/png", CancellationToken.None);

        var ex = await act.Should().ThrowAsync<ImageStorageException>();
        ex.Which.Code.Should().Be("IMAGE_DIMENSIONS_TOO_LARGE");
    }

    [Fact]
    public async Task SanitizeAsync_rejects_image_whose_pixel_count_exceeds_max_pixels()
    {
        var safety = new ImageSafetyOptions
        {
            MaxWidth = 64,
            MaxHeight = 64,
            MaxPixels = 100,
            MaxDimension = 64
        };
        var sanitizer = new ImageSanitizer(safety, maxBytes: 20 * 1024 * 1024);

        // 32x32 = 1024 pixels > MaxPixels (100), yet each side is within MaxWidth/MaxHeight — the
        // decompression-bomb shape the MaxPixels ceiling exists to catch.
        var bomb = CreatePng(width: 32, height: 32);

        var act = () => sanitizer.SanitizeAsync(bomb, "image/png", CancellationToken.None);

        var ex = await act.Should().ThrowAsync<ImageStorageException>();
        ex.Which.Code.Should().Be("IMAGE_DIMENSIONS_TOO_LARGE");
    }

    [Fact]
    public async Task SanitizeAsync_accepts_image_within_dimension_limits()
    {
        var safety = new ImageSafetyOptions
        {
            MaxWidth = 64,
            MaxHeight = 64,
            MaxPixels = 4096,
            MaxDimension = 64
        };
        var sanitizer = new ImageSanitizer(safety, maxBytes: 20 * 1024 * 1024);

        // 8x8 = 64 pixels, well inside every limit — the metadata pre-check must not regress valid
        // uploads.
        var ok = CreatePng(width: 8, height: 8);

        var result = await sanitizer.SanitizeAsync(ok, "image/png", CancellationToken.None);

        result.Should().NotBeEmpty();
        using var roundTripped = Image.Load(result);
        roundTripped.Width.Should().Be(8);
        roundTripped.Height.Should().Be(8);
    }

    private static byte[] CreatePng(int width, int height)
    {
        using var image = new Image<Rgba32>(width, height);
        using var output = new MemoryStream();
        image.SaveAsPng(output, new PngEncoder { SkipMetadata = true });
        return output.ToArray();
    }
}
