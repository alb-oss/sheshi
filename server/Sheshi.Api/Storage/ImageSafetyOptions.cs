namespace Sheshi.Api.Storage;

public class ImageSafetyOptions
{
    // Hard decode ceiling (reject beyond this) — guards against decompression-bomb images that are
    // tiny on disk but huge in memory. Raised so ordinary phone/camera photos (e.g. 12–24 MP) are
    // accepted and downscaled rather than rejected.
    public int MaxWidth { get; set; } = 8192;
    public int MaxHeight { get; set; } = 8192;
    public long MaxPixels { get; set; } = 30_000_000;

    // Stored images are downscaled so their longest side is at most this — the display size for a
    // feed/thread. Drives most of the file-size savings.
    public int MaxDimension { get; set; } = 1280;
}
