# S3/MinIO object storage — design + plan

**Date:** 2026-06-14
**Status:** accepted
**Author:** working session

## Problem

Uploaded images and videos are written to a local `./uploads` folder and served by the API's
static-file middleware. That doesn't survive a container restart, doesn't scale past one box, and
ties file serving to the app process. We want the same validated bytes to land in S3-compatible
object storage (MinIO locally, S3/R2 in prod) by changing only configuration — no controller,
validation, or frontend change.

## What already exists (the seam)

Files flow through two interfaces, `IImageStorage` and `IVideoStorage`, each:

```csharp
Task<string> SaveAsync(Stream stream, string contentType, CancellationToken ct = default);
```

`LocalFileImageStorage` validates type → buffers → size-caps → **re-encodes/sanitizes via ImageSharp
(strips metadata, drops trailing payload, the security-critical step)** → writes to disk → returns
`{PublicBaseUrl}/{fileName}`. `LocalFileVideoStorage` does the same minus re-encode: type allowlist +
**magic-byte signature** + size cap, then writes as-is. Controller and DTOs only touch the interface.

## Decision: split *validation* from *sink*

The senior's framing was "add an `S3ImageStorage : IImageStorage`." We refine it: a new S3 storage
class would have to **duplicate** the ImageSharp sanitize and magic-byte checks — the most
security-sensitive code in the app, and the part with the most regression tests. Duplicating it is a
liability.

Instead, introduce one more seam **below** the validators:

```csharp
public interface IBlobStore
{
    // Persist already-validated bytes under a generated key; return the public URL.
    Task<string> PutAsync(byte[] content, string fileName, string contentType, CancellationToken ct = default);
}
```

- `IImageStorage`/`IVideoStorage` keep *all* validation, generate the `{guid}{ext}` filename (they own
  the content-type→extension map), then hand the validated bytes to `IBlobStore`.
- `LocalBlobStore` writes to `UploadPath/{fileName}` (today's disk tail).
- `S3BlobStore` does a `PutObject` with key=`fileName`.
- Both return `{PublicBaseUrl}/{fileName}`.

Swapping local↔S3 is a **one-line DI change** keyed off `Storage:Provider`. Validation is never
duplicated; the existing storage tests cover both backends unchanged (default provider = local).

The validating classes are renamed `LocalFileImageStorage`→`ImageStorage`,
`LocalFileVideoStorage`→`VideoStorage` (they're no longer disk-specific). Tests reference only the
`IImageStorage`/`IVideoStorage` abstractions, so the rename is safe.

## Serving: bucket public-read, not presigned

A civic forum's images/videos are public. Public-read is far simpler than minting presigned URLs on
every render, and keeps `PublicBaseUrl` a plain prefix the frontend already uses. The MinIO bucket
gets an anonymous **download** policy at startup. We do **not** set per-object canned ACLs — modern
S3 buckets disable ACLs (Bucket Owner Enforced), so a bucket policy is the portable choice.

## Config (`StorageOptions`)

```jsonc
"Storage": {
  "Provider": "local",                 // "local" | "s3"
  "PublicBaseUrl": "http://localhost:5080/uploads",   // for s3: http://localhost:9000/sheshi-uploads
  "S3": {
    "Endpoint": "http://localhost:9000",
    "Bucket": "sheshi-uploads",
    "AccessKey": "minioadmin",
    "SecretKey": "minioadmin",
    "Region": "us-east-1",
    "ForcePathStyle": true             // MinIO requires path-style URLs
  }
}
```

Defaults keep `Provider = "local"`, so existing behavior is unchanged with no config. Real S3/R2 in
prod = flip `Provider` to `s3`, point `Endpoint`/`PublicBaseUrl` at the provider, and supply keys via
secrets/env (`Storage__S3__AccessKey`, …). Keys are **never committed** — local dev uses MinIO's
obvious `minioadmin` defaults.

## docker-compose

Add a `minio` service (`minio/minio`, API `:9000`, console `:9001`, root creds `minioadmin`, a named
volume) and a one-shot `minio-init` (`minio/mc`) that waits for MinIO, creates the `sheshi-uploads`
bucket, and sets it anonymous-download. Idempotent (`mc mb --ignore-existing`).

## Plan (atomic commits)

1. **docs** — this design doc.
2. **feat(api): IBlobStore seam** — add `IBlobStore` + `LocalBlobStore`; refactor
   `LocalFileImageStorage`/`LocalFileVideoStorage` into provider-agnostic `ImageStorage`/`VideoStorage`
   that delegate the write to `IBlobStore`. Register `LocalBlobStore`. No behavior change (provider
   defaults to local). Existing storage tests stay green.
3. **feat(api): S3 blob store + provider switch** — add `AWSSDK.S3`; `S3StorageOptions` on
   `StorageOptions`; `S3BlobStore`; DI selects `IBlobStore` (and registers `IAmazonS3` for MinIO) by
   `Storage:Provider`.
4. **chore(infra): MinIO in docker-compose** — `minio` + `minio-init` services; documented env in
   `appsettings` comments.
5. **test(api): S3 round-trip** — an integration test (skipped unless a MinIO endpoint is configured)
   that PUTs a validated image via the s3 provider and asserts the returned URL is fetchable.

## Verification

- `dotnet build` + full test suite (local provider path unchanged).
- Bring up MinIO via compose; run the API with `Storage__Provider=s3`; post an image + a video; confirm
  the returned `video_url`/`image_url` resolve from MinIO and render in the web app.

## Out of scope

- Migrating existing local files to S3 (none in prod yet).
- CDN/R2 specifics, lifecycle rules, presigned uploads — later if needed.
- Wiring karma into ranking (separate effort).
