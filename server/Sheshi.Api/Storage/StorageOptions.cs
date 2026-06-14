namespace Sheshi.Api.Storage;

public class StorageOptions
{
    // Which IBlobStore sink to use: "local" (disk + /uploads static serving) or "s3"
    // (S3-compatible object storage; MinIO locally, S3/R2 in prod). Defaults to local so the app
    // runs with no extra config.
    public string Provider { get; set; } = "local";
    public string UploadPath { get; set; } = "./uploads";
    public string PublicBaseUrl { get; set; } = "http://localhost:5080/uploads";
    public long MaxBytes { get; set; } = 20 * 1024 * 1024;
    public long MaxVideoBytes { get; set; } = 50 * 1024 * 1024;
    public S3StorageOptions S3 { get; set; } = new();
}

public class S3StorageOptions
{
    // S3 API endpoint. MinIO: http://localhost:9000. Leave empty to use AWS's default regional
    // endpoint (real S3).
    public string Endpoint { get; set; } = "http://localhost:9000";
    public string Bucket { get; set; } = "sheshi-uploads";
    public string AccessKey { get; set; } = "";
    public string AccessKeyFile { get; set; } = "";
    public string SecretKey { get; set; } = "";
    public string SecretKeyFile { get; set; } = "";
    public string Region { get; set; } = "us-east-1";
    // MinIO (and most non-AWS S3) need path-style URLs (host/bucket/key) rather than virtual-hosted
    // (bucket.host/key). Keep true for MinIO; AWS S3 works with either.
    public bool ForcePathStyle { get; set; } = true;
}
