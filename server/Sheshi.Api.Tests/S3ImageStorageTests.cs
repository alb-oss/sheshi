using System.Net;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using FluentAssertions;
using Microsoft.Extensions.Options;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Png;
using SixLabors.ImageSharp.PixelFormats;
using Sheshi.Api.Storage;

namespace Sheshi.Api.Tests;

public class S3ImageStorageTests
{
    [Fact]
    public async Task SaveAsync_uploads_sanitized_image_and_returns_public_url()
    {
        var client = new RecordingS3Client();
        var storage = new S3ImageStorage(
            Options.Create(new StorageOptions
            {
                PublicBaseUrl = "https://uploads.sheshi.al",
                MaxBytes = 5242880,
                S3 = new S3StorageOptions
                {
                    Bucket = "sheshi-uploads"
                }
            }),
            Options.Create(new ImageSafetyOptions()),
            client);

        await using var stream = new MemoryStream(CreateOnePixelPng());

        var url = await storage.SaveAsync(stream, "image/png");

        url.Should().StartWith("https://uploads.sheshi.al/");
        url.Should().EndWith(".png");
        client.LastRequest.Should().NotBeNull();
        client.LastRequest!.BucketName.Should().Be("sheshi-uploads");
        client.LastRequest.ContentType.Should().Be("image/png");
        client.UploadedBytes.Should().NotBeEmpty();
    }

    private static byte[] CreateOnePixelPng()
    {
        using var image = new Image<Rgba32>(1, 1);
        image[0, 0] = new Rgba32(255, 0, 0, 255);
        using var output = new MemoryStream();
        image.SaveAsPng(output, new PngEncoder { SkipMetadata = true });
        return output.ToArray();
    }

    private sealed class RecordingS3Client : AmazonS3Client
    {
        public PutObjectRequest? LastRequest { get; private set; }
        public byte[] UploadedBytes { get; private set; } = [];

        public RecordingS3Client()
            : base(new AnonymousAWSCredentials(), new AmazonS3Config
            {
                ServiceURL = "http://localhost",
                ForcePathStyle = true
            })
        {
        }

        public override async Task<PutObjectResponse> PutObjectAsync(
            PutObjectRequest request,
            CancellationToken cancellationToken = default)
        {
            LastRequest = request;
            await using var buffer = new MemoryStream();
            await request.InputStream.CopyToAsync(buffer, cancellationToken);
            UploadedBytes = buffer.ToArray();
            return new PutObjectResponse { HttpStatusCode = HttpStatusCode.OK };
        }
    }
}
