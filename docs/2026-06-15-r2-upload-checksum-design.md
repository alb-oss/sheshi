# Uploads fail on prod (500) — Cloudflare R2 + AWS SDK v4 checksum

**Date:** 2026-06-15
**Status:** in progress

## Symptom

Uploading a video on sheshi.live fails with the generic toast *"Diçka shkoi keq. Provo sërish."* and no
reason — for both a 31.9 MB and a 0.4 MB `.MOV`.

## Analysis (evidence)

- The client toast is `errors.generic`, **not** `errors.videoInvalid` → the server returned an **unmapped**
  error, i.e. a 500 (the validation errors `INVALID_VIDEO` / `VIDEO_TOO_LARGE` / `UNSUPPORTED_VIDEO_TYPE`
  are all caught and surfaced as the "video invalid" message).
- Direct probe of prod (`api.sheshi.live`): **every** `.MOV` upload (30 KB → 35 MB) returns
  **HTTP 500 `{"error":"INTERNAL_ERROR"}`** — size-independent.
- A real 20 KB **image** upload to prod also returns **500** → **not video-specific; all S3 uploads are
  broken on prod.**
- Local `LocalBlobStore` (disk): valid `.MOV` → 201. So the validation code is fine.
- Local **MinIO** (`minio:latest`) via the S3 path: valid `.MOV` → **201** — i.e. the S3 code works
  against a current MinIO.
- Prod object storage is **Cloudflare R2** (`deploy/hetzner/production.env.example`:
  `Storage__S3__Endpoint=…r2.cloudflarestorage.com`, `Region=auto`), and `AWSSDK.S3` is **v4.0.24.4**.

**Root cause:** AWS SDK for .NET **v4** defaults `RequestChecksumCalculation = WHEN_SUPPORTED`, so every
`PutObject` is sent with a CRC32 integrity checksum using **aws-chunked / trailer** encoding. **Cloudflare
R2 rejects that trailer**, so `PutObjectAsync` throws (a non-`ImageStorageException`), which the upload
path doesn't catch → bubbles to the global handler → **500 `INTERNAL_ERROR`** → generic toast. A current
MinIO accepts the trailer, which is why local worked and prod didn't.

Two faults, really: (1) the checksum incompatibility breaks every upload on R2; (2) the upload path turns
any storage failure into a **silent generic 500** with no log and no reason — exactly the "no reason"
the user hit.

## Fix

1. **Checksum compatibility (the upload fix).** Build the `AmazonS3Config` via a small, testable
   `S3ClientFactory.BuildConfig(S3StorageOptions)` that sets
   `RequestChecksumCalculation = WHEN_REQUIRED` and `ResponseChecksumValidation = WHEN_REQUIRED`
   (the pre-v4 behaviour R2 accepts), keeping `ForcePathStyle` + `AuthenticationRegion`. `Program.cs`
   uses the factory.
2. **Surface storage failures (the "no reason" fix).** In `MessagesController`, wrap the image/video save
   so a non-`ImageStorageException` is **logged** (structured, with content-type + size) and returned as
   `502 { error: "UPLOAD_FAILED" }` instead of a silent 500. The client maps `UPLOAD_FAILED` to a clear
   message ("Ngarkimi dështoi…").

No change to validation, size caps, or the blob layout.

## Tests

- Unit (`S3ClientFactoryTests`): `BuildConfig` sets both checksum knobs to `WHEN_REQUIRED`, carries
  `ForcePathStyle`, and applies the region — locks the fix so an SDK bump can't silently re-break R2.
- Manual: re-probe prod after deploy (valid `.MOV` + image → 201); confirm local MinIO still 201 (no
  regression).

## Plan

1. **docs** — this file.
2. **fix(api): R2-compatible S3 checksum + surfaced upload errors** — factory + Program.cs + controller
   + client mapping + tests.
