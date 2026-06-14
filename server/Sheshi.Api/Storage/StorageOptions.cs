namespace Sheshi.Api.Storage;

public class StorageOptions
{
    public string Provider { get; set; } = "local";
    public string UploadPath { get; set; } = "./uploads";
    public string PublicBaseUrl { get; set; } = "http://localhost:5080/uploads";
    public long MaxBytes { get; set; } = 5 * 1024 * 1024;
    public S3StorageOptions S3 { get; set; } = new();
}

public class S3StorageOptions
{
    public string Bucket { get; set; } = "";
    public string Endpoint { get; set; } = "";
    public string Region { get; set; } = "";
    public string AccessKey { get; set; } = "";
    public string AccessKeyFile { get; set; } = "";
    public string SecretKey { get; set; } = "";
    public string SecretKeyFile { get; set; } = "";
    public bool ForcePathStyle { get; set; } = true;
}
