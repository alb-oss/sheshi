namespace Sheshi.Api.Storage;

public class StorageOptions
{
    public string UploadPath { get; set; } = "./uploads";
    public string PublicBaseUrl { get; set; } = "http://localhost:5080/uploads";
    public long MaxBytes { get; set; } = 5 * 1024 * 1024;
}
