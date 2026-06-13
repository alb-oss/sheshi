namespace Sheshi.Api.Storage;

public class ImageSafetyOptions
{
    public int MaxWidth { get; set; } = 4096;
    public int MaxHeight { get; set; } = 4096;
    public long MaxPixels { get; set; } = 12_000_000;
}
