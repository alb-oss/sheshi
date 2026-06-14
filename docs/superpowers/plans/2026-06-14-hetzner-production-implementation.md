# Hetzner Production Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Sheshi production-ready for a single Hetzner VM with Docker Compose, Caddy, Cloudflare, Hetzner Object Storage, encrypted backups, and fully automatic `main` deployments from GitHub Actions.

**Architecture:** Keep compute on one Hetzner VM, but move uploaded media and encrypted backups to Hetzner Object Storage. Build immutable web/API images in GitHub Actions, publish them to GHCR, and deploy by SSH to a narrow server-side deploy script with health checks and rollback.

**Tech Stack:** TanStack Start, React, Node 22, ASP.NET Core .NET 10, EF Core, PostgreSQL 17, SignalR, Docker Compose, Caddy, GHCR, GitHub Actions, Hetzner Cloud, Hetzner Object Storage, restic, S3-compatible storage.

---

## Scope And Sequencing

The approved design covers several production subsystems. Implement it in this order so every checkpoint leaves the repo in a working state:

1. Repo hygiene and toolchain pinning.
2. API runtime hardening: file secrets, forwarded headers, readiness health.
3. Production object storage.
4. Container packaging and Compose/Caddy production runtime.
5. Deploy, rollback, backup, and restore scripts.
6. GitHub Actions CI, image publishing, and auto-deploy.
7. Runbooks and final verification.

Assumptions used by this plan:

- GitHub repo: `alb-oss/sheshi`.
- Production web domain: `sheshi.al`.
- Production API domain: `api.sheshi.al`.
- Production uploads domain: `uploads.sheshi.al`.
- GHCR images: `ghcr.io/alb-oss/sheshi-web` and `ghcr.io/alb-oss/sheshi-api`.
- The implementation branch is created before code execution. Use branch prefix `codex/`.

## File Structure Map

Create or modify these files:

- Modify `package.json`: point root scripts at the real root app and server solution.
- Modify `Makefile`: point build commands at the real root app and `server/Sheshi.sln`.
- Modify `.gitignore`: ignore `.env`, production env files, and local secret files.
- Remove tracked `.env` from git index.
- Create `.node-version`: pin Node 22.
- Create `global.json`: pin .NET 10 SDK.
- Modify `.env.example`: keep dev-safe values and add production-shaped non-secret keys.
- Modify `server/Sheshi.Api/Program.cs`: file-secret config, forwarded headers, health endpoints, storage provider selection.
- Modify `server/Sheshi.Api/Email/SmtpEmailSender.cs`: read SMTP password from file secret support.
- Create `server/Sheshi.Api/Configuration/SecretFileConfigurationExtensions.cs`: central file-secret helper.
- Create `server/Sheshi.Api/Health/ReadinessChecks.cs`: readiness check logic.
- Create `server/Sheshi.Api/Storage/ImageSanitizer.cs`: shared image validation/sanitization.
- Modify `server/Sheshi.Api/Storage/LocalFileImageStorage.cs`: delegate image cleanup to `ImageSanitizer`.
- Modify `server/Sheshi.Api/Storage/StorageOptions.cs`: add provider and S3-compatible options.
- Create `server/Sheshi.Api/Storage/S3ImageStorage.cs`: production object storage implementation.
- Modify `server/Sheshi.Api/Sheshi.Api.csproj`: add S3 SDK package.
- Add focused tests under `server/Sheshi.Api.Tests`.
- Create `.dockerignore`: keep Docker contexts small and secret-free.
- Create `Dockerfile.web`: web SSR image.
- Create `server/Sheshi.Api/Dockerfile`: API image.
- Create `deploy/hetzner/docker-compose.prod.yml`: production Compose stack.
- Create `deploy/hetzner/Caddyfile`: production reverse proxy config.
- Create `deploy/hetzner/production.env.example`: non-secret production env template.
- Create scripts under `deploy/hetzner/scripts/`: deploy, rollback, migrate, backup, restore drill.
- Create `.github/workflows/ci.yml`.
- Create `.github/workflows/publish-images.yml`.
- Create `.github/workflows/deploy-production.yml`.
- Create `docs/ops/hetzner-production.md`.
- Create `docs/ops/secret-rotation.md`.
- Create `docs/ops/backup-restore.md`.

## Task 1: Repo Hygiene And Toolchain Pins

**Files:**

- Modify: `package.json`
- Modify: `Makefile`
- Modify: `.gitignore`
- Modify: `.env.example`
- Create: `.node-version`
- Create: `global.json`
- Modify: `server/Sheshi.Api.Tests/EnvTemplateTests.cs`
- Remove from git index: `.env`

- [ ] **Step 1: Create the branch**

Run:

```bash
git checkout -b codex/hetzner-production-readiness
```

Expected: branch switches to `codex/hetzner-production-readiness`.

- [ ] **Step 2: Write the failing env/template test**

Modify `server/Sheshi.Api.Tests/EnvTemplateTests.cs` so the test asserts that `.env.example` contains production-shaped keys and no stale legacy app-path references:

```csharp
using FluentAssertions;

namespace Sheshi.Api.Tests;

public class EnvTemplateTests
{
    [Fact]
    public void Env_template_uses_compose_host_postgres_port()
    {
        var repoRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../.."));
        var envTemplate = File.ReadAllText(Path.Combine(repoRoot, ".env.example"));

        envTemplate.Should().Contain("ConnectionStrings__Default=Host=localhost;Port=55432;");
        envTemplate.Should().Contain("VITE_API_BASE_URL=http://localhost:5080");
        envTemplate.Should().Contain("Storage__PublicBaseUrl=http://localhost:5080/uploads");
        envTemplate.Should().Contain("Cors__AllowedOrigins=");
        envTemplate.Should().Contain("http://localhost:3001");
        envTemplate.Should().Contain("Frontend__BaseUrl=http://localhost:3001");
        envTemplate.Should().Contain("SeedAdmin__Email=");
        envTemplate.Should().Contain("Storage__Provider=local");
        envTemplate.Should().Contain("Storage__S3__Bucket=");
        envTemplate.Should().Contain("Storage__S3__Endpoint=");
        envTemplate.Should().Contain("Storage__S3__AccessKeyFile=");
        envTemplate.Should().Contain("Storage__S3__SecretKeyFile=");
        envTemplate.Should().NotContain(string.Concat("SUPA", "BASE"));
        envTemplate.Should().NotContain(string.Join("_", "alb", "sheshi"));
    }
}
```

- [ ] **Step 3: Run the failing env/template test**

Run:

```bash
dotnet test server/Sheshi.Api.Tests/Sheshi.Api.Tests.csproj --filter EnvTemplateTests
```

Expected: FAIL because `.env.example` does not yet include the new storage keys.

- [ ] **Step 4: Update package scripts**

Modify the `scripts` object in `package.json` to this:

```json
{
  "dev": "vite dev",
  "build": "npm run backend:build && npm run frontend:build",
  "frontend:build": "vite build",
  "backend:build": "dotnet build server/Sheshi.sln",
  "test": "npm run backend:test",
  "backend:test": "dotnet test server/Sheshi.sln",
  "preview": "vite preview",
  "lint": "eslint .",
  "format": "prettier --write .",
  "legacy:dev": "vite dev",
  "legacy:build": "vite build",
  "legacy:build:dev": "vite build --mode development",
  "legacy:lint": "eslint .",
  "legacy:format": "prettier --write ."
}
```

- [ ] **Step 5: Update `Makefile`**

Replace `Makefile` with:

```makefile
.PHONY: build backend-build backend-test frontend-build frontend-dev

build: backend-build frontend-build

backend-build:
	dotnet build server/Sheshi.sln

backend-test:
	dotnet test server/Sheshi.sln

frontend-build:
	npm run frontend:build

frontend-dev:
	npm run dev
```

- [ ] **Step 6: Pin Node and .NET**

Create `.node-version`:

```text
22
```

Create `global.json`:

```json
{
  "sdk": {
    "version": "10.0.100",
    "rollForward": "latestFeature"
  }
}
```

- [ ] **Step 7: Ignore local secret files**

Modify `.gitignore` to include:

```gitignore
.env
.env.*
!.env.example
deploy/hetzner/*.env
deploy/hetzner/secrets/
*.agekey
```

Keep the existing `*.local` ignore rule.

- [ ] **Step 8: Stop tracking local `.env`**

Run:

```bash
git rm --cached .env
```

Expected: `.env` is removed from the git index but remains on disk locally.

- [ ] **Step 9: Update `.env.example`**

Ensure `.env.example` contains these dev-safe keys:

```dotenv
ConnectionStrings__Default=Host=localhost;Port=55432;Database=sheshi;Username=sheshi;Password=sheshi
Jwt__Issuer=https://sheshi.local
Jwt__Audience=sheshi-web
Jwt__SigningKey=CHANGE_ME_min_32_byte_random_secret_value_here
Jwt__SigningKeyFile=
Jwt__AccessTokenMinutes=15
Jwt__RefreshTokenDays=30
Cors__AllowedOrigins=http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001,http://localhost:8080,http://127.0.0.1:8080
Frontend__BaseUrl=http://localhost:3001
Storage__Provider=local
Storage__UploadPath=./uploads
Storage__PublicBaseUrl=http://localhost:5080/uploads
Storage__MaxBytes=5242880
Storage__S3__Bucket=
Storage__S3__Endpoint=
Storage__S3__Region=
Storage__S3__AccessKey=
Storage__S3__AccessKeyFile=
Storage__S3__SecretKey=
Storage__S3__SecretKeyFile=
Smtp__Host=localhost
Smtp__Port=1025
Smtp__FromEmail=no-reply@sheshi.local
Smtp__Username=
Smtp__Password=
Smtp__PasswordFile=
Smtp__EnableSsl=false
Authentication__Google__ClientId=
Authentication__Google__ClientSecret=
Authentication__Microsoft__ClientId=
Authentication__Microsoft__ClientSecret=
Authentication__Apple__ClientId=
Authentication__Apple__TeamId=
Authentication__Apple__KeyId=
Authentication__Apple__PrivateKey=
SeedAdmin__Email=
SeedAdmin__Password=
VITE_API_BASE_URL=http://localhost:5080
```

- [ ] **Step 10: Verify root scripts no longer reference stale paths**

Run:

```bash
node -e "const p=require('./package.json'); const bad=JSON.stringify(p.scripts).includes(['alb','sheshi'].join('_')); if (bad) process.exit(1);"
rg -n "$(printf 'alb_%s' sheshi)" package.json Makefile .env.example
```

Expected: the Node command exits `0`; `rg` exits `1` with no matches for the three files.

- [ ] **Step 11: Run tests for the task**

Run:

```bash
dotnet test server/Sheshi.Api.Tests/Sheshi.Api.Tests.csproj --filter EnvTemplateTests
git diff --check
```

Expected: tests PASS and `git diff --check` prints nothing.

- [ ] **Step 12: Commit**

Run:

```bash
git add package.json Makefile .gitignore .env.example .node-version global.json server/Sheshi.Api.Tests/EnvTemplateTests.cs .env
git commit -m "chore: align repo scripts and toolchain pins"
```

## Task 2: File Secrets And Runtime Config

**Files:**

- Create: `server/Sheshi.Api/Configuration/SecretFileConfigurationExtensions.cs`
- Modify: `server/Sheshi.Api/Program.cs`
- Modify: `server/Sheshi.Api/Email/SmtpEmailSender.cs`
- Create: `server/Sheshi.Api.Tests/SecretFileConfigurationTests.cs`

- [ ] **Step 1: Write failing tests for file-secret lookup**

Create `server/Sheshi.Api.Tests/SecretFileConfigurationTests.cs`:

```csharp
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Sheshi.Api.Configuration;

namespace Sheshi.Api.Tests;

public class SecretFileConfigurationTests
{
    [Fact]
    public async Task GetSecretValue_prefers_file_when_file_key_is_set()
    {
        var path = Path.Combine(Path.GetTempPath(), $"sheshi-secret-{Guid.NewGuid():N}");
        await File.WriteAllTextAsync(path, "from-file\n");
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:SigningKey"] = "from-env",
                ["Jwt:SigningKeyFile"] = path
            })
            .Build();

        configuration.GetSecretValue("Jwt:SigningKey").Should().Be("from-file");
    }

    [Fact]
    public void GetSecretValue_uses_direct_value_when_file_key_is_empty()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Smtp:Password"] = "direct-secret",
                ["Smtp:PasswordFile"] = ""
            })
            .Build();

        configuration.GetSecretValue("Smtp:Password").Should().Be("direct-secret");
    }

    [Fact]
    public void GetRequiredSecretValue_throws_when_secret_is_missing()
    {
        var configuration = new ConfigurationBuilder().Build();

        var action = () => configuration.GetRequiredSecretValue("Jwt:SigningKey");

        action.Should().Throw<InvalidOperationException>()
            .WithMessage("Missing required configuration value 'Jwt:SigningKey' or 'Jwt:SigningKeyFile'.");
    }
}
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
dotnet test server/Sheshi.Api.Tests/Sheshi.Api.Tests.csproj --filter SecretFileConfigurationTests
```

Expected: FAIL because `Sheshi.Api.Configuration.SecretFileConfigurationExtensions` does not exist.

- [ ] **Step 3: Add the file-secret helper**

Create `server/Sheshi.Api/Configuration/SecretFileConfigurationExtensions.cs`:

```csharp
namespace Sheshi.Api.Configuration;

public static class SecretFileConfigurationExtensions
{
    public static string? GetSecretValue(this IConfiguration configuration, string key)
    {
        var fileKey = $"{key}File";
        var filePath = configuration[fileKey];
        if (!string.IsNullOrWhiteSpace(filePath))
        {
            var value = File.ReadAllText(filePath.Trim());
            return value.TrimEnd('\r', '\n');
        }

        var direct = configuration[key];
        return string.IsNullOrWhiteSpace(direct) ? null : direct;
    }

    public static string GetRequiredSecretValue(this IConfiguration configuration, string key)
    {
        var value = configuration.GetSecretValue(key);
        if (!string.IsNullOrWhiteSpace(value)) return value;

        throw new InvalidOperationException(
            $"Missing required configuration value '{key}' or '{key}File'.");
    }
}
```

- [ ] **Step 4: Use file-secret helper for JWT signing key**

Modify `server/Sheshi.Api/Program.cs`:

```csharp
using Sheshi.Api.Configuration;
```

Replace:

```csharp
var signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.SigningKey));
```

With:

```csharp
var jwtSigningKey = builder.Configuration.GetRequiredSecretValue("Jwt:SigningKey");
var signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSigningKey));
```

- [ ] **Step 5: Use file-secret helper for SMTP password**

Modify `server/Sheshi.Api/Email/SmtpEmailSender.cs`:

```csharp
using Sheshi.Api.Configuration;
```

Replace:

```csharp
var password = configuration["Smtp:Password"];
```

With:

```csharp
var password = configuration.GetSecretValue("Smtp:Password");
```

- [ ] **Step 6: Run tests for the task**

Run:

```bash
dotnet test server/Sheshi.Api.Tests/Sheshi.Api.Tests.csproj --filter SecretFileConfigurationTests
dotnet test server/Sheshi.Api.Tests/Sheshi.Api.Tests.csproj --filter SmokeTests
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add server/Sheshi.Api/Configuration/SecretFileConfigurationExtensions.cs server/Sheshi.Api/Program.cs server/Sheshi.Api/Email/SmtpEmailSender.cs server/Sheshi.Api.Tests/SecretFileConfigurationTests.cs
git commit -m "feat(api): support file-backed secrets"
```

## Task 3: Proxy Headers And Readiness Health

**Files:**

- Modify: `server/Sheshi.Api/Program.cs`
- Create: `server/Sheshi.Api/Health/ReadinessChecks.cs`
- Modify: `server/Sheshi.Api.Tests/SmokeTests.cs`
- Create: `server/Sheshi.Api.Tests/ForwardedHeadersTests.cs`

- [ ] **Step 1: Expand smoke tests for live and ready endpoints**

Modify `server/Sheshi.Api.Tests/SmokeTests.cs`:

```csharp
using System.Net;
using FluentAssertions;

namespace Sheshi.Api.Tests;

public class SmokeTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Health_returns_200()
    {
        var client = factory.CreateClient();

        var response = await client.GetAsync("/health");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.Content.ReadAsStringAsync()).Should().Be("ok");
    }

    [Fact]
    public async Task Live_health_returns_200()
    {
        var client = factory.CreateClient();

        var response = await client.GetAsync("/health/live");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.Content.ReadAsStringAsync()).Should().Be("live");
    }

    [Fact]
    public async Task Ready_health_returns_200_when_database_is_available()
    {
        var client = factory.CreateClient();

        var response = await client.GetAsync("/health/ready");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.Content.ReadAsStringAsync()).Should().Be("ready");
    }
}
```

- [ ] **Step 2: Add forwarded-header test**

Create `server/Sheshi.Api.Tests/ForwardedHeadersTests.cs`:

```csharp
using System.Net;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace Sheshi.Api.Tests;

public class ForwardedHeadersTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task External_auth_uses_forwarded_https_scheme_when_proxy_headers_are_trusted()
    {
        var client = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Proxy:TrustForwardedHeaders"] = "true",
                    ["Authentication:Google:ClientId"] = "client-id",
                    ["Authentication:Google:ClientSecret"] = "client-secret"
                });
            });
        }).CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false
        });

        var request = new HttpRequestMessage(HttpMethod.Get, "/api/auth/external/google");
        request.Headers.Add("X-Forwarded-Proto", "https");
        request.Headers.Add("X-Forwarded-Host", "api.sheshi.al");

        var response = await client.SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.Redirect);
        response.Headers.Location!.ToString().Should().Contain("redirect_uri=https%3A%2F%2Fapi.sheshi.al%2Fapi%2Fauth%2Fexternal%2Fcallback");
    }
}
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
dotnet test server/Sheshi.Api.Tests/Sheshi.Api.Tests.csproj --filter "SmokeTests|ForwardedHeadersTests"
```

Expected: FAIL because `/health/live`, `/health/ready`, and forwarded-header handling are not implemented yet.

- [ ] **Step 4: Add readiness check class**

Create `server/Sheshi.Api/Health/ReadinessChecks.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Sheshi.Api.Data;

namespace Sheshi.Api.Health;

public static class ReadinessChecks
{
    public static async Task<IResult> CheckAsync(AppDbContext db, CancellationToken ct)
    {
        var canConnect = await db.Database.CanConnectAsync(ct);
        return canConnect
            ? Results.Text("ready")
            : Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
    }
}
```

- [ ] **Step 5: Configure forwarded headers**

Modify `server/Sheshi.Api/Program.cs`.

Add imports:

```csharp
using Microsoft.AspNetCore.HttpOverrides;
using Sheshi.Api.Health;
```

Add service configuration before `var app = builder.Build();`:

```csharp
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders =
        ForwardedHeaders.XForwardedFor |
        ForwardedHeaders.XForwardedProto |
        ForwardedHeaders.XForwardedHost;
    options.KnownNetworks.Clear();
    options.KnownProxies.Clear();
});
```

Add middleware before `app.UseHttpsRedirection();`:

```csharp
if (app.Configuration.GetValue<bool>("Proxy:TrustForwardedHeaders"))
{
    app.UseForwardedHeaders();
}
```

Add endpoints near the existing `/health` endpoint:

```csharp
app.MapGet("/health/live", () => "live");
app.MapGet("/health/ready", ReadinessChecks.CheckAsync);
app.MapGet("/health", () => "ok");
```

Keep the existing `/health` compatibility endpoint.

- [ ] **Step 6: Run tests for the task**

Run:

```bash
dotnet test server/Sheshi.Api.Tests/Sheshi.Api.Tests.csproj --filter "SmokeTests|ForwardedHeadersTests"
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add server/Sheshi.Api/Program.cs server/Sheshi.Api/Health/ReadinessChecks.cs server/Sheshi.Api.Tests/SmokeTests.cs server/Sheshi.Api.Tests/ForwardedHeadersTests.cs
git commit -m "feat(api): add proxy-aware readiness health"
```

## Task 4: S3-Compatible Image Storage

**Files:**

- Modify: `server/Sheshi.Api/Sheshi.Api.csproj`
- Modify: `server/Sheshi.Api/Storage/StorageOptions.cs`
- Create: `server/Sheshi.Api/Storage/ImageSanitizer.cs`
- Modify: `server/Sheshi.Api/Storage/LocalFileImageStorage.cs`
- Create: `server/Sheshi.Api/Storage/S3ImageStorage.cs`
- Modify: `server/Sheshi.Api/Program.cs`
- Create: `server/Sheshi.Api.Tests/S3ImageStorageTests.cs`
- Modify: `server/Sheshi.Api.Tests/RealtimeStorageModerationTests.cs`

- [ ] **Step 1: Add S3 SDK package**

Run:

```bash
dotnet add server/Sheshi.Api/Sheshi.Api.csproj package AWSSDK.S3
```

Expected: `server/Sheshi.Api/Sheshi.Api.csproj` includes `AWSSDK.S3`.

- [ ] **Step 2: Write failing test for S3 storage behavior**

Create `server/Sheshi.Api.Tests/S3ImageStorageTests.cs`:

```csharp
using System.Net;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using FluentAssertions;
using Microsoft.Extensions.Options;
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

    private static byte[] CreateOnePixelPng() =>
    [
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
        0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
        0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 15, 4, 0,
        9, 251, 3, 253, 167, 213, 181, 65, 0, 0, 0, 0, 73, 69, 78,
        68, 174, 66, 96, 130
    ];

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

        public override async Task<PutObjectResponse> PutObjectAsync(PutObjectRequest request, CancellationToken cancellationToken = default)
        {
            LastRequest = request;
            await using var buffer = new MemoryStream();
            await request.InputStream.CopyToAsync(buffer, cancellationToken);
            UploadedBytes = buffer.ToArray();
            return new PutObjectResponse { HttpStatusCode = HttpStatusCode.OK };
        }
    }
}
```

- [ ] **Step 3: Run failing test**

Run:

```bash
dotnet test server/Sheshi.Api.Tests/Sheshi.Api.Tests.csproj --filter S3ImageStorageTests
```

Expected: FAIL because `S3ImageStorage` and `S3StorageOptions` do not exist.

- [ ] **Step 4: Expand storage options**

Modify `server/Sheshi.Api/Storage/StorageOptions.cs`:

```csharp
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
```

- [ ] **Step 5: Extract image sanitizer**

Create `server/Sheshi.Api/Storage/ImageSanitizer.cs` by moving the validation and re-encoding logic out of `LocalFileImageStorage`:

```csharp
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.Formats.Png;
using SixLabors.ImageSharp.Formats.Webp;

namespace Sheshi.Api.Storage;

public class ImageSanitizer
{
    private readonly ImageSafetyOptions _imageSafety;
    private readonly long _maxBytes;

    public ImageSanitizer(ImageSafetyOptions imageSafety, long maxBytes)
    {
        _imageSafety = imageSafety;
        _maxBytes = maxBytes;
    }

    public async Task<byte[]> SanitizeAsync(byte[] bytes, string contentType, CancellationToken ct)
    {
        try
        {
            var detected = Image.DetectFormat(bytes);
            if (detected is null || !MatchesContentType(detected, contentType))
                throw new ImageStorageException("INVALID_IMAGE");

            using var image = Image.Load(bytes);
            var pixels = (long)image.Width * image.Height;
            if (image.Width <= 0 ||
                image.Height <= 0 ||
                image.Width > _imageSafety.MaxWidth ||
                image.Height > _imageSafety.MaxHeight ||
                pixels > _imageSafety.MaxPixels)
            {
                throw new ImageStorageException("IMAGE_DIMENSIONS_TOO_LARGE");
            }

            StripMetadata(image);

            await using var output = new MemoryStream();
            await SaveInClaimedFormatAsync(image, output, contentType, ct);
            if (output.Length > _maxBytes)
                throw new ImageStorageException("IMAGE_TOO_LARGE");
            return output.ToArray();
        }
        catch (ImageStorageException)
        {
            throw;
        }
        catch (Exception ex) when (ex is InvalidImageContentException or UnknownImageFormatException or NotSupportedException)
        {
            throw new ImageStorageException("INVALID_IMAGE");
        }
    }

    private static bool MatchesContentType(IImageFormat format, string contentType) =>
        format.MimeTypes.Any(m => string.Equals(m, contentType, StringComparison.OrdinalIgnoreCase));

    private static void StripMetadata(Image image)
    {
        image.Metadata.ExifProfile = null;
        image.Metadata.XmpProfile = null;
        image.Metadata.IptcProfile = null;
        image.Metadata.IccProfile = null;
        foreach (var frame in image.Frames)
        {
            frame.Metadata.ExifProfile = null;
            frame.Metadata.XmpProfile = null;
            frame.Metadata.IptcProfile = null;
            frame.Metadata.IccProfile = null;
        }
    }

    private static Task SaveInClaimedFormatAsync(Image image, Stream output, string contentType, CancellationToken ct) =>
        contentType switch
        {
            "image/jpeg" => image.SaveAsJpegAsync(output, new JpegEncoder { Quality = 88, SkipMetadata = true }, ct),
            "image/png" => image.SaveAsPngAsync(output, new PngEncoder { SkipMetadata = true }, ct),
            "image/webp" => image.SaveAsWebpAsync(output, new WebpEncoder { Quality = 90, SkipMetadata = true }, ct),
            _ => throw new ImageStorageException("UNSUPPORTED_IMAGE_TYPE")
        };
}
```

- [ ] **Step 6: Refactor local storage to use the sanitizer**

In `server/Sheshi.Api/Storage/LocalFileImageStorage.cs`, remove the private sanitizer methods and replace the sanitization line with:

```csharp
var sanitizer = new ImageSanitizer(_imageSafety, _options.MaxBytes);
var sanitized = await sanitizer.SanitizeAsync(buffer.ToArray(), contentType, ct);
```

Remove no-longer-used `SixLabors.ImageSharp` format imports from `LocalFileImageStorage.cs`.

- [ ] **Step 7: Add S3 image storage**

Create `server/Sheshi.Api/Storage/S3ImageStorage.cs`:

```csharp
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Options;

namespace Sheshi.Api.Storage;

public class S3ImageStorage(
    IOptions<StorageOptions> options,
    IOptions<ImageSafetyOptions> imageSafetyOptions,
    IAmazonS3 s3) : IImageStorage
{
    private static readonly IReadOnlyDictionary<string, string> Extensions = new Dictionary<string, string>
    {
        ["image/jpeg"] = ".jpg",
        ["image/png"] = ".png",
        ["image/webp"] = ".webp"
    };

    private readonly StorageOptions _options = options.Value;
    private readonly ImageSafetyOptions _imageSafety = imageSafetyOptions.Value;

    public async Task<string> SaveAsync(Stream stream, string contentType, CancellationToken ct = default)
    {
        contentType = contentType.Trim().ToLowerInvariant();
        if (!Extensions.TryGetValue(contentType, out var extension))
            throw new ImageStorageException("UNSUPPORTED_IMAGE_TYPE");

        await using var buffer = new MemoryStream();
        await stream.CopyToAsync(buffer, ct);
        if (buffer.Length > _options.MaxBytes)
            throw new ImageStorageException("IMAGE_TOO_LARGE");

        var sanitizer = new ImageSanitizer(_imageSafety, _options.MaxBytes);
        var sanitized = await sanitizer.SanitizeAsync(buffer.ToArray(), contentType, ct);
        var fileName = $"{Guid.NewGuid():N}{extension}";

        await using var upload = new MemoryStream(sanitized);
        await s3.PutObjectAsync(new PutObjectRequest
        {
            BucketName = _options.S3.Bucket,
            Key = fileName,
            InputStream = upload,
            ContentType = contentType,
            AutoCloseStream = false
        }, ct);

        return $"{_options.PublicBaseUrl.TrimEnd('/')}/{fileName}";
    }
}
```

- [ ] **Step 8: Register S3 storage in `Program.cs`**

In `server/Sheshi.Api/Program.cs`, add imports:

```csharp
using Amazon;
using Amazon.Runtime;
using Amazon.S3;
```

Replace:

```csharp
builder.Services.AddScoped<IImageStorage, LocalFileImageStorage>();
```

With:

```csharp
var storageProvider = builder.Configuration["Storage:Provider"]?.Trim().ToLowerInvariant() ?? "local";
if (storageProvider == "s3")
{
    builder.Services.AddSingleton<IAmazonS3>(_ =>
    {
        var storage = builder.Configuration.GetSection("Storage").Get<StorageOptions>() ?? new StorageOptions();
        var accessKey = builder.Configuration.GetSecretValue("Storage:S3:AccessKey") ?? storage.S3.AccessKey;
        var secretKey = builder.Configuration.GetSecretValue("Storage:S3:SecretKey") ?? storage.S3.SecretKey;
        var config = new AmazonS3Config
        {
            ServiceURL = storage.S3.Endpoint,
            ForcePathStyle = storage.S3.ForcePathStyle,
            AuthenticationRegion = string.IsNullOrWhiteSpace(storage.S3.Region) ? "us-east-1" : storage.S3.Region
        };
        return new AmazonS3Client(new BasicAWSCredentials(accessKey, secretKey), config);
    });
    builder.Services.AddScoped<IImageStorage, S3ImageStorage>();
}
else
{
    builder.Services.AddScoped<IImageStorage, LocalFileImageStorage>();
}
```

- [ ] **Step 9: Update storage tests that assert local URL**

Keep the existing `RealtimeStorageModerationTests` local URL expectations for the default local provider:

```csharp
// Local storage remains the default provider for tests and development.
message!.ImageUrl.Should().StartWith("http://localhost:5080/uploads/");
```

- [ ] **Step 10: Run tests for the task**

Run:

```bash
dotnet test server/Sheshi.Api.Tests/Sheshi.Api.Tests.csproj --filter "S3ImageStorageTests|RealtimeStorageModerationTests"
```

Expected: PASS.

- [ ] **Step 11: Commit**

Run:

```bash
git add server/Sheshi.Api/Sheshi.Api.csproj server/Sheshi.Api/Storage server/Sheshi.Api/Program.cs server/Sheshi.Api.Tests/S3ImageStorageTests.cs server/Sheshi.Api.Tests/RealtimeStorageModerationTests.cs
git commit -m "feat(api): add s3 image storage"
```

## Task 5: Production Docker And Compose Runtime

**Files:**

- Create: `.dockerignore`
- Create: `Dockerfile.web`
- Create: `server/Sheshi.Api/Dockerfile`
- Create: `deploy/hetzner/docker-compose.prod.yml`
- Create: `deploy/hetzner/Caddyfile`
- Create: `deploy/hetzner/production.env.example`

- [ ] **Step 1: Add `.dockerignore`**

Create `.dockerignore`:

```dockerignore
.git
.github
.agents
.desloppify
.desloppify-bin
node_modules
mobile/node_modules
dist
dist-ssr
.output
.vinxi
.tanstack
.nitro
server/**/bin
server/**/obj
.env
.env.*
deploy/hetzner/secrets
*.agekey
*.log
.DS_Store
```

- [ ] **Step 2: Add web Dockerfile**

Create `Dockerfile.web`:

```dockerfile
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run frontend:build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
COPY --from=build /app/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
```

- [ ] **Step 3: Add API Dockerfile**

Create `server/Sheshi.Api/Dockerfile`:

```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY server/Sheshi.sln server/Sheshi.sln
COPY server/Sheshi.Api/Sheshi.Api.csproj server/Sheshi.Api/Sheshi.Api.csproj
COPY server/Sheshi.Api.Tests/Sheshi.Api.Tests.csproj server/Sheshi.Api.Tests/Sheshi.Api.Tests.csproj
RUN dotnet restore server/Sheshi.sln
COPY server server
RUN dotnet publish server/Sheshi.Api/Sheshi.Api.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
ENV ASPNETCORE_ENVIRONMENT=Production
ENV ASPNETCORE_URLS=http://0.0.0.0:8080
COPY --from=build /app/publish .
EXPOSE 8080
ENTRYPOINT ["dotnet", "Sheshi.Api.dll"]
```

- [ ] **Step 4: Add production Compose file**

Create `deploy/hetzner/docker-compose.prod.yml`:

```yaml
services:
  caddy:
    image: caddy:2.10-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on:
      - web
      - api

  web:
    image: ghcr.io/alb-oss/sheshi-web:${SHESHI_IMAGE_TAG}
    restart: unless-stopped
    env_file:
      - ${SHESHI_ROOT:-/opt/sheshi}/env/production.env
    environment:
      NODE_ENV: production
      HOST: 0.0.0.0
      PORT: 3000

  api:
    image: ghcr.io/alb-oss/sheshi-api:${SHESHI_IMAGE_TAG}
    restart: unless-stopped
    env_file:
      - ${SHESHI_ROOT:-/opt/sheshi}/env/production.env
    environment:
      ASPNETCORE_ENVIRONMENT: Production
      ASPNETCORE_URLS: http://0.0.0.0:8080
      Proxy__TrustForwardedHeaders: "true"
      ConnectionStrings__DefaultFile: /run/secrets/db_connection_string
      Jwt__SigningKeyFile: /run/secrets/jwt_signing_key
      Smtp__PasswordFile: /run/secrets/smtp_password
      Storage__S3__AccessKeyFile: /run/secrets/object_storage_access_key
      Storage__S3__SecretKeyFile: /run/secrets/object_storage_secret_key
    secrets:
      - db_connection_string
      - jwt_signing_key
      - smtp_password
      - object_storage_access_key
      - object_storage_secret_key
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:8080/health/ready || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 5

  db:
    image: postgres:17
    restart: unless-stopped
    environment:
      POSTGRES_DB: sheshi
      POSTGRES_USER: sheshi
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    secrets:
      - db_password
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U sheshi -d sheshi"]
      interval: 10s
      timeout: 5s
      retries: 10

secrets:
  db_password:
    file: ${SHESHI_ROOT:-/opt/sheshi}/secrets/db_password
  db_connection_string:
    file: ${SHESHI_ROOT:-/opt/sheshi}/secrets/db_connection_string
  jwt_signing_key:
    file: ${SHESHI_ROOT:-/opt/sheshi}/secrets/jwt_signing_key
  smtp_password:
    file: ${SHESHI_ROOT:-/opt/sheshi}/secrets/smtp_password
  object_storage_access_key:
    file: ${SHESHI_ROOT:-/opt/sheshi}/secrets/object_storage_access_key
  object_storage_secret_key:
    file: ${SHESHI_ROOT:-/opt/sheshi}/secrets/object_storage_secret_key

volumes:
  postgres-data:
  caddy-data:
  caddy-config:
```

- [ ] **Step 5: Add Caddyfile**

Create `deploy/hetzner/Caddyfile`:

```caddyfile
{
	email admin@sheshi.al
}

sheshi.al {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		Permissions-Policy "geolocation=(), microphone=(), camera=()"
	}
	reverse_proxy web:3000
}

api.sheshi.al {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		Permissions-Policy "geolocation=(), microphone=(), camera=()"
	}
	reverse_proxy api:8080
}
```

- [ ] **Step 6: Add production env example**

Create `deploy/hetzner/production.env.example`:

```dotenv
SHESHI_IMAGE_TAG=0000000000000000000000000000000000000000
VITE_API_BASE_URL=https://api.sheshi.al
Jwt__Issuer=https://api.sheshi.al
Jwt__Audience=sheshi-web
Jwt__AccessTokenMinutes=15
Jwt__RefreshTokenDays=30
Frontend__BaseUrl=https://sheshi.al
Cors__AllowedOrigins=https://sheshi.al
AllowedHosts=sheshi.al;api.sheshi.al
Storage__Provider=s3
Storage__PublicBaseUrl=https://uploads.sheshi.al
Storage__MaxBytes=5242880
Storage__S3__Bucket=sheshi-uploads
Storage__S3__Endpoint=https://fsn1.your-objectstorage.com
Storage__S3__Region=fsn1
Storage__S3__ForcePathStyle=true
Smtp__Host=smtp.postmarkapp.com
Smtp__Port=587
Smtp__FromEmail=no-reply@sheshi.al
Smtp__Username=postmark-server-token
Smtp__EnableSsl=true
RESTIC_REPOSITORY=s3:https://fsn1.your-objectstorage.com/sheshi-backups
Authentication__Google__ClientId=
Authentication__Microsoft__ClientId=
Authentication__Apple__ClientId=
Authentication__Apple__TeamId=
Authentication__Apple__KeyId=
Authentication__Apple__PrivateKey=
SeedAdmin__Email=
SeedAdmin__Password=
```

- [ ] **Step 7: Validate Docker builds locally**

Run:

```bash
docker build -f Dockerfile.web -t sheshi-web:test .
docker build -f server/Sheshi.Api/Dockerfile -t sheshi-api:test .
tmp="$(mktemp -d)"
mkdir -p "$tmp/env" "$tmp/secrets"
cp deploy/hetzner/production.env.example "$tmp/env/production.env"
for name in db_password db_connection_string jwt_signing_key smtp_password object_storage_access_key object_storage_secret_key; do
  printf 'test-secret\n' > "$tmp/secrets/$name"
done
SHESHI_ROOT="$tmp" docker compose -f deploy/hetzner/docker-compose.prod.yml config >/tmp/sheshi-compose.prod.rendered.yml
rm -rf "$tmp"
```

Expected: both images build; Compose config renders without errors.

- [ ] **Step 8: Commit**

Run:

```bash
git add .dockerignore Dockerfile.web server/Sheshi.Api/Dockerfile deploy/hetzner/docker-compose.prod.yml deploy/hetzner/Caddyfile deploy/hetzner/production.env.example
git commit -m "feat(deploy): add production compose runtime"
```

## Task 6: Deploy, Rollback, Backup, And Restore Scripts

**Files:**

- Create: `deploy/hetzner/scripts/deploy.sh`
- Create: `deploy/hetzner/scripts/rollback.sh`
- Create: `deploy/hetzner/scripts/migrate.sh`
- Create: `deploy/hetzner/scripts/backup-now.sh`
- Create: `deploy/hetzner/scripts/restore-drill.sh`
- Modify: `server/Sheshi.Api/Program.cs`

- [ ] **Step 1: Add deploy script**

Create `deploy/hetzner/scripts/deploy.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

TAG="${1:?usage: deploy.sh IMAGE_TAG}"
ROOT="/opt/sheshi"
COMPOSE="$ROOT/compose/docker-compose.prod.yml"
ENV_FILE="$ROOT/env/production.env"
STATE="$ROOT/state"
LOCK="$STATE/deploy.lock"

mkdir -p "$STATE"

(
  flock -n 9

  PREVIOUS_TAG="$(grep '^SHESHI_IMAGE_TAG=' "$ENV_FILE" | cut -d= -f2- || true)"
  printf '%s\n' "$PREVIOUS_TAG" > "$STATE/previous-image-tag"

  sed -i.bak "s/^SHESHI_IMAGE_TAG=.*/SHESHI_IMAGE_TAG=$TAG/" "$ENV_FILE"

  docker compose --env-file "$ENV_FILE" -f "$COMPOSE" pull web api
  "$ROOT/scripts/migrate.sh" "$TAG"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE" up -d web api caddy

  for i in $(seq 1 30); do
    if curl -fsS https://api.sheshi.al/health/ready >/dev/null && curl -fsS https://sheshi.al >/dev/null; then
      printf '%s\n' "$TAG" > "$STATE/last-good-image-tag"
      printf '{"tag":"%s","deployed_at":"%s"}\n' "$TAG" "$(date -Is)" > "$STATE/last-deploy.json"
      exit 0
    fi
    sleep 5
  done

  "$ROOT/scripts/rollback.sh"
  exit 1
) 9>"$LOCK"
```

- [ ] **Step 2: Add rollback script**

Create `deploy/hetzner/scripts/rollback.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/sheshi"
COMPOSE="$ROOT/compose/docker-compose.prod.yml"
ENV_FILE="$ROOT/env/production.env"
STATE="$ROOT/state"

PREVIOUS_TAG="$(cat "$STATE/previous-image-tag")"
if [ -z "$PREVIOUS_TAG" ]; then
  echo "No previous image tag recorded; cannot rollback" >&2
  exit 1
fi

sed -i.bak "s/^SHESHI_IMAGE_TAG=.*/SHESHI_IMAGE_TAG=$PREVIOUS_TAG/" "$ENV_FILE"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE" up -d web api caddy

for i in $(seq 1 20); do
  if curl -fsS https://api.sheshi.al/health/ready >/dev/null && curl -fsS https://sheshi.al >/dev/null; then
    echo "Rollback to $PREVIOUS_TAG succeeded"
    exit 0
  fi
  sleep 5
done

echo "Rollback to $PREVIOUS_TAG failed health checks" >&2
exit 1
```

- [ ] **Step 3: Add `--migrate-only` API behavior**

Modify `server/Sheshi.Api/Program.cs`.

Add before the startup migration block:

```csharp
var migrateOnly = args.Contains("--migrate-only", StringComparer.OrdinalIgnoreCase);
```

Change:

```csharp
var autoMigrate = app.Environment.IsDevelopment() || app.Configuration.GetValue<bool>("Database:AutoMigrate");
```

To:

```csharp
var autoMigrate = migrateOnly || app.Environment.IsDevelopment() || app.Configuration.GetValue<bool>("Database:AutoMigrate");
```

After the migration/seed `try`/`catch` block and before middleware configuration, add:

```csharp
if (migrateOnly)
{
    return;
}
```

- [ ] **Step 4: Add migration script**

Create `deploy/hetzner/scripts/migrate.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

TAG="${1:?usage: migrate.sh IMAGE_TAG}"
ROOT="/opt/sheshi"
COMPOSE="$ROOT/compose/docker-compose.prod.yml"
ENV_FILE="$ROOT/env/production.env"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE" run --rm \
  -e Database__AutoMigrate=true \
  api dotnet Sheshi.Api.dll --migrate-only

echo "Migration step completed for $TAG"
```

- [ ] **Step 5: Add backup script**

Create `deploy/hetzner/scripts/backup-now.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/sheshi"
ENV_FILE="$ROOT/env/production.env"
BACKUP_DIR="$ROOT/state/backups"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"

set -a
source "$ENV_FILE"
set +a

docker compose --env-file "$ENV_FILE" -f "$ROOT/compose/docker-compose.prod.yml" exec -T db \
  pg_dump -U sheshi -d sheshi --format=custom \
  > "$BACKUP_DIR/sheshi-$STAMP.dump"

RESTIC_PASSWORD_FILE="$ROOT/secrets/backup_encryption_key" \
AWS_ACCESS_KEY_ID="$(cat "$ROOT/secrets/object_storage_access_key")" \
AWS_SECRET_ACCESS_KEY="$(cat "$ROOT/secrets/object_storage_secret_key")" \
restic -r "s3:$RESTIC_REPOSITORY" backup "$BACKUP_DIR/sheshi-$STAMP.dump"

RESTIC_PASSWORD_FILE="$ROOT/secrets/backup_encryption_key" \
AWS_ACCESS_KEY_ID="$(cat "$ROOT/secrets/object_storage_access_key")" \
AWS_SECRET_ACCESS_KEY="$(cat "$ROOT/secrets/object_storage_secret_key")" \
restic -r "s3:$RESTIC_REPOSITORY" forget --keep-daily 7 --keep-weekly 5 --keep-monthly 12 --prune

rm -f "$BACKUP_DIR/sheshi-$STAMP.dump"
date -Is > "$ROOT/state/last-backup-at"
```

- [ ] **Step 6: Add restore drill script**

Create `deploy/hetzner/scripts/restore-drill.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/sheshi"
DRILL_DIR="$ROOT/state/restore-drill"
mkdir -p "$DRILL_DIR"

RESTIC_PASSWORD_FILE="$ROOT/secrets/backup_encryption_key" \
AWS_ACCESS_KEY_ID="$(cat "$ROOT/secrets/object_storage_access_key")" \
AWS_SECRET_ACCESS_KEY="$(cat "$ROOT/secrets/object_storage_secret_key")" \
restic -r "s3:$RESTIC_REPOSITORY" restore latest --target "$DRILL_DIR"

LATEST_DUMP="$(find "$DRILL_DIR" -name 'sheshi-*.dump' | sort | tail -n 1)"
test -n "$LATEST_DUMP"

docker run --rm --name sheshi-restore-drill-db \
  -e POSTGRES_USER=sheshi \
  -e POSTGRES_PASSWORD=sheshi \
  -e POSTGRES_DB=sheshi \
  -d postgres:17

trap 'docker rm -f sheshi-restore-drill-db >/dev/null 2>&1 || true' EXIT

sleep 8
cat "$LATEST_DUMP" | docker exec -i sheshi-restore-drill-db pg_restore -U sheshi -d sheshi --clean --if-exists
docker exec sheshi-restore-drill-db psql -U sheshi -d sheshi -c "select count(*) from \"Rooms\";"
date -Is > "$ROOT/state/last-restore-drill-at"
```

- [ ] **Step 7: Make scripts executable and lint shell syntax**

Run:

```bash
chmod +x deploy/hetzner/scripts/*.sh
bash -n deploy/hetzner/scripts/deploy.sh
bash -n deploy/hetzner/scripts/rollback.sh
bash -n deploy/hetzner/scripts/migrate.sh
bash -n deploy/hetzner/scripts/backup-now.sh
bash -n deploy/hetzner/scripts/restore-drill.sh
```

Expected: all syntax checks exit `0`.

- [ ] **Step 8: Commit**

Run:

```bash
git add deploy/hetzner/scripts deploy/hetzner/production.env.example server/Sheshi.Api/Program.cs
git commit -m "feat(deploy): add hetzner operations scripts"
```

## Task 7: GitHub Actions CI, Images, And Auto-Deploy

**Files:**

- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/publish-images.yml`
- Create: `.github/workflows/deploy-production.yml`

Pinned action SHAs resolved on 2026-06-14:

- `actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5`
- `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020`
- `actions/setup-dotnet@67a3573c9a986a3f9c594539f4ab511d57bb3ce9`
- `docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f`
- `docker/login-action@c94ce9fb468520275223c153574b00df6fe4bcc9`
- `docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8`

- [ ] **Step 1: Add CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: ci

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5

      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version-file: .node-version
          cache: npm

      - uses: actions/setup-dotnet@67a3573c9a986a3f9c594539f4ab511d57bb3ce9
        with:
          global-json-file: global.json

      - run: npm ci
      - run: npm run frontend:build
      - run: dotnet restore server/Sheshi.sln
      - run: dotnet build server/Sheshi.sln --configuration Release --no-restore
      - run: dotnet test server/Sheshi.sln --configuration Release --no-build

  docker-build:
    runs-on: ubuntu-24.04
    needs: test
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5
      - uses: docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f
      - uses: docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8
        with:
          context: .
          file: Dockerfile.web
          push: false
          tags: sheshi-web:ci
      - uses: docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8
        with:
          context: .
          file: server/Sheshi.Api/Dockerfile
          push: false
          tags: sheshi-api:ci
```

- [ ] **Step 2: Add image publishing workflow**

Create `.github/workflows/publish-images.yml`:

```yaml
name: publish-images

on:
  workflow_run:
    workflows: [ci]
    branches: [main]
    types: [completed]

permissions:
  contents: read
  packages: write
  attestations: write
  id-token: write

jobs:
  publish:
    if: github.event.workflow_run.conclusion == 'success'
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5
        with:
          ref: ${{ github.event.workflow_run.head_sha }}

      - uses: docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f

      - uses: docker/login-action@c94ce9fb468520275223c153574b00df6fe4bcc9
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - uses: docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8
        with:
          context: .
          file: Dockerfile.web
          push: true
          tags: |
            ghcr.io/alb-oss/sheshi-web:${{ github.event.workflow_run.head_sha }}
            ghcr.io/alb-oss/sheshi-web:main

      - uses: docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8
        with:
          context: .
          file: server/Sheshi.Api/Dockerfile
          push: true
          tags: |
            ghcr.io/alb-oss/sheshi-api:${{ github.event.workflow_run.head_sha }}
            ghcr.io/alb-oss/sheshi-api:main
```

- [ ] **Step 3: Add deploy workflow**

Create `.github/workflows/deploy-production.yml`:

```yaml
name: deploy-production

on:
  workflow_run:
    workflows: [publish-images]
    branches: [main]
    types: [completed]

permissions:
  contents: read

concurrency:
  group: production
  cancel-in-progress: false

jobs:
  deploy:
    if: github.event.workflow_run.conclusion == 'success'
    runs-on: ubuntu-24.04
    environment:
      name: production
      url: https://sheshi.al
    steps:
      - name: Prepare SSH key
        run: |
          set -euo pipefail
          mkdir -p ~/.ssh
          printf '%s\n' "${{ secrets.PROD_SSH_PRIVATE_KEY }}" > ~/.ssh/id_ed25519
          printf '%s\n' "${{ secrets.PROD_SSH_KNOWN_HOSTS }}" > ~/.ssh/known_hosts
          chmod 700 ~/.ssh
          chmod 600 ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/known_hosts

      - name: Deploy commit image
        run: |
          set -euo pipefail
          ssh -i ~/.ssh/id_ed25519 \
            -o IdentitiesOnly=yes \
            -o StrictHostKeyChecking=yes \
            -p "${{ secrets.PROD_SSH_PORT || '22' }}" \
            "${{ secrets.PROD_SSH_USER }}@${{ secrets.PROD_SSH_HOST }}" \
            "/opt/sheshi/scripts/deploy.sh '${{ github.event.workflow_run.head_sha }}'"
```

- [ ] **Step 4: Validate workflow syntax**

Run:

```bash
python3 - <<'PY'
import yaml
from pathlib import Path
for path in Path(".github/workflows").glob("*.yml"):
    yaml.safe_load(path.read_text())
    print(path)
PY
```

Expected: all three workflow paths print without exceptions.

- [ ] **Step 5: Commit**

Run:

```bash
git add .github/workflows/ci.yml .github/workflows/publish-images.yml .github/workflows/deploy-production.yml
git commit -m "ci: add production build and deploy workflows"
```

## Task 8: Operations Runbooks

**Files:**

- Create: `docs/ops/hetzner-production.md`
- Create: `docs/ops/secret-rotation.md`
- Create: `docs/ops/backup-restore.md`
- Modify: `README.md`

- [ ] **Step 1: Add Hetzner production runbook**

Create `docs/ops/hetzner-production.md` with:

```markdown
# Hetzner Production Runbook

Production runs on one Hetzner VM using Docker Compose and Caddy.

## Required Host Paths

- `/opt/sheshi/compose/docker-compose.prod.yml`
- `/opt/sheshi/compose/Caddyfile`
- `/opt/sheshi/env/production.env`
- `/opt/sheshi/secrets/*`
- `/opt/sheshi/scripts/*.sh`
- `/opt/sheshi/state/`

## First Server Bootstrap

1. Create Debian 13 or Ubuntu LTS VM in Hetzner.
2. Point Cloudflare DNS records `sheshi.al` and `api.sheshi.al` at the VM.
3. Install Docker Engine and Docker Compose plugin.
4. Create `sheshi` Unix group and deploy user.
5. Copy Compose, Caddyfile, and scripts to `/opt/sheshi`.
6. Create runtime secret files under `/opt/sheshi/secrets`.
7. Create `/opt/sheshi/env/production.env` from `deploy/hetzner/production.env.example`.
8. Run `/opt/sheshi/scripts/deploy.sh COMMIT_SHA`.

## Daily Operations

- Check external uptime monitor.
- Check backup freshness timestamp.
- Check disk usage.
- Review failed GitHub Actions deploys.
```

- [ ] **Step 2: Add secret rotation runbook**

Create `docs/ops/secret-rotation.md` with sections for:

```markdown
# Secret Rotation Runbook

## Immediate Rotation Triggers

- A secret appears in git history.
- A secret appears in GitHub Actions logs.
- A maintainer device is lost.
- A maintainer leaves the project.

## Runtime Secret Location

Runtime secrets live under `/opt/sheshi/secrets`.

## Recovery Copy

Keep a recovery copy in a team password manager or a private SOPS + age encrypted ops repository.

## Rotation Order

1. Create the replacement secret.
2. Update the recovery copy.
3. Update the matching file under `/opt/sheshi/secrets/` on the VM.
4. Restart the affected service.
5. Verify health checks.
6. Revoke the old secret.
7. Record the rotation date.
```

- [ ] **Step 3: Add backup and restore runbook**

Create `docs/ops/backup-restore.md` with:

```markdown
# Backup And Restore Runbook

## Backup Schedule

Run `/opt/sheshi/scripts/backup-now.sh` daily.

## Retention

- 7 daily backups.
- 5 weekly backups.
- 12 monthly backups.

## Restore Drill

Run `/opt/sheshi/scripts/restore-drill.sh` monthly.

## Production Restore

1. Stop web and API containers.
2. Keep Postgres stopped until the restore target is selected.
3. Restore the selected encrypted backup from Hetzner Object Storage.
4. Restore into Postgres.
5. Start API.
6. Check `/health/ready`.
7. Start web.
8. Check `https://sheshi.al`.
```

- [ ] **Step 4: Update root README**

Modify `README.md` so it states:

```markdown
## Production Deployment

The production deployment design is documented in:

- `docs/superpowers/specs/2026-06-14-hetzner-production-design.md`
- `docs/superpowers/plans/2026-06-14-hetzner-production-implementation.md`
- `docs/ops/hetzner-production.md`
```

Remove claims that canonical production code lives under the old app folder.

- [ ] **Step 5: Commit**

Run:

```bash
git add docs/ops/hetzner-production.md docs/ops/secret-rotation.md docs/ops/backup-restore.md README.md
git commit -m "docs: add production operations runbooks"
```

## Task 9: Final Verification And Production Gate

**Files:**

- Modify only files needed to fix failures discovered by this task.

- [ ] **Step 1: Run full backend verification**

Run:

```bash
dotnet restore server/Sheshi.sln
dotnet build server/Sheshi.sln --configuration Release --no-restore
dotnet test server/Sheshi.sln --configuration Release --no-build
```

Expected: all commands PASS.

- [ ] **Step 2: Run frontend verification**

Run:

```bash
npm ci
npm run frontend:build
```

Expected: all commands PASS and `.output/server/index.mjs` exists.

- [ ] **Step 3: Run Docker verification**

Run:

```bash
docker build -f Dockerfile.web -t sheshi-web:verify .
docker build -f server/Sheshi.Api/Dockerfile -t sheshi-api:verify .
tmp="$(mktemp -d)"
mkdir -p "$tmp/env" "$tmp/secrets"
cp deploy/hetzner/production.env.example "$tmp/env/production.env"
for name in db_password db_connection_string jwt_signing_key smtp_password object_storage_access_key object_storage_secret_key; do
  printf 'test-secret\n' > "$tmp/secrets/$name"
done
SHESHI_ROOT="$tmp" docker compose -f deploy/hetzner/docker-compose.prod.yml config >/tmp/sheshi-compose.verify.yml
rm -rf "$tmp"
```

Expected: image builds PASS and Compose config renders.

- [ ] **Step 4: Run syntax and hygiene verification**

Run:

```bash
bash -n deploy/hetzner/scripts/*.sh
git diff --check
rg -n "$(printf 'alb_%s|SUPA%s' sheshi BASE)" package.json Makefile README.md .env.example docs deploy server src
```

Expected: shell syntax PASS, diff check prints nothing, `rg` prints no stale production-path or Supabase env references in those targets.

- [ ] **Step 5: Confirm production acceptance checklist**

Confirm these are true in the final PR description:

```markdown
- [ ] Root scripts build the real app and API.
- [ ] `.env` is no longer tracked.
- [ ] Node and .NET toolchains are pinned.
- [ ] API supports file-backed secrets.
- [ ] API is proxy-aware behind Caddy/Cloudflare.
- [ ] API exposes live and ready health endpoints.
- [ ] Production image storage uses S3-compatible object storage.
- [ ] Web and API Docker images build.
- [ ] Production Compose config exists.
- [ ] Caddy config exists.
- [ ] Deploy and rollback scripts exist and pass shell syntax checks.
- [ ] Backup and restore-drill scripts exist and pass shell syntax checks.
- [ ] GitHub Actions CI exists.
- [ ] GitHub Actions image publishing exists.
- [ ] GitHub Actions production deploy exists.
- [ ] Operations runbooks exist.
```

- [ ] **Step 6: Commit final fixes**

If Step 1 through Step 4 required fixes, commit them:

```bash
git add .
git commit -m "fix: complete hetzner production verification"
```

If no files changed, do not create an empty commit.
