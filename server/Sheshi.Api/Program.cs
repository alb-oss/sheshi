using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Amazon.Runtime;
using Amazon.S3;
using AspNet.Security.OAuth.Apple;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.IdentityModel.Tokens;
using Sheshi.Api.Auth;
using Sheshi.Api.Configuration;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;
using Sheshi.Api.Email;
using Sheshi.Api.Features.Messages;
using Sheshi.Api.Features.Moderation;
using Sheshi.Api.Features.Rooms;
using Sheshi.Api.Health;
using Sheshi.Api.Realtime;
using Sheshi.Api.Storage;

var migrateOnly = args.Contains("--migrate-only", StringComparer.OrdinalIgnoreCase);
if (migrateOnly)
{
    args = args
        .Where(arg => !string.Equals(arg, "--migrate-only", StringComparison.OrdinalIgnoreCase))
        .ToArray();
}

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.

builder.Services.AddControllers()
    .AddJsonOptions(o =>
    {
        o.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower;
        o.JsonSerializerOptions.DictionaryKeyPolicy = JsonNamingPolicy.SnakeCaseLower;
        o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower));
    });
// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();
builder.Services.Configure<JwtOptions>(builder.Configuration.GetSection("Jwt"));
builder.Services.PostConfigure<JwtOptions>(o =>
    o.SigningKey = builder.Configuration.GetRequiredSecretValue("Jwt:SigningKey"));
builder.Services.Configure<StorageOptions>(builder.Configuration.GetSection("Storage"));
// Anchor uploads to a stable absolute path under the content root, so files saved in one run
// aren't orphaned (404) when the app later starts from a different working directory.
builder.Services.PostConfigure<StorageOptions>(o =>
    o.UploadPath = Path.GetFullPath(o.UploadPath, builder.Environment.ContentRootPath));
builder.Services.Configure<ImageSafetyOptions>(builder.Configuration.GetSection("ImageSafety"));
builder.Services.AddScoped<TokenService>();
builder.Services.AddScoped<IEmailSender, SmtpEmailSender>();
builder.Services.AddScoped<MessageService>();
builder.Services.AddScoped<IContentClassifier, NoopContentClassifier>();
builder.Services.AddScoped<ModerationActionLogger>();
builder.Services.AddScoped<ModerationMetricsService>();
builder.Services.AddScoped<ModerationRuleEngine>();
builder.Services.AddScoped<RoomService>();
builder.Services.AddScoped<Sheshi.Api.Features.Users.UserStatsService>();
builder.Services.AddScoped<IImageStorage, ImageStorage>();
builder.Services.AddScoped<IVideoStorage, VideoStorage>();
// Sink selection: "s3" uploads validated bytes to S3-compatible object storage (MinIO/S3/R2);
// anything else writes to local disk. Keyed off Storage:Provider so prod flips to S3 by changing
// only config — the validating ImageStorage/VideoStorage are unaffected.
if (string.Equals(builder.Configuration["Storage:Provider"], "s3", StringComparison.OrdinalIgnoreCase))
{
    builder.Services.AddSingleton<IAmazonS3>(sp =>
    {
        var s3 = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<StorageOptions>>().Value.S3;
        if (string.IsNullOrWhiteSpace(s3.Bucket))
            throw new InvalidOperationException("Storage:S3:Bucket is required when Storage:Provider=s3.");

        var accessKey = builder.Configuration.GetRequiredSecretValue("Storage:S3:AccessKey");
        var secretKey = builder.Configuration.GetRequiredSecretValue("Storage:S3:SecretKey");
        var config = new AmazonS3Config
        {
            ForcePathStyle = s3.ForcePathStyle,
            AuthenticationRegion = string.IsNullOrWhiteSpace(s3.Region) ? "us-east-1" : s3.Region
        };
        if (!string.IsNullOrWhiteSpace(s3.Endpoint)) config.ServiceURL = s3.Endpoint;
        return new AmazonS3Client(new BasicAWSCredentials(accessKey, secretKey), config);
    });
    builder.Services.AddScoped<IBlobStore, S3BlobStore>();
}
else
{
    builder.Services.AddScoped<IBlobStore, LocalBlobStore>();
}
builder.Services.AddSingleton<PresenceTracker>();
builder.Services.AddSingleton<HighlightsTicker>();
builder.Services.AddScoped<RealtimeNotifier>();
builder.Services.AddSignalR().AddJsonProtocol(o =>
{
    o.PayloadSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower;
    o.PayloadSerializerOptions.DictionaryKeyPolicy = JsonNamingPolicy.SnakeCaseLower;
    o.PayloadSerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower));
});
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.OnRejected = async (context, ct) =>
    {
        if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
            context.HttpContext.Response.Headers.RetryAfter = Math.Ceiling(retryAfter.TotalSeconds).ToString("0");

        await context.HttpContext.Response.WriteAsJsonAsync(new { error = "RATE_LIMITED" }, cancellationToken: ct);
    };

    AddFixedPolicy(options, builder.Configuration, "auth", "Auth", preferUser: false, defaultPermitLimit: 200, defaultWindowSeconds: 60);
    AddFixedPolicy(options, builder.Configuration, "writes", "Writes", preferUser: true, defaultPermitLimit: 30, defaultWindowSeconds: 60);
    AddFixedPolicy(options, builder.Configuration, "reports", "Reports", preferUser: true, defaultPermitLimit: 10, defaultWindowSeconds: 300);
    AddFixedPolicy(options, builder.Configuration, "moderation", "Moderation", preferUser: true, defaultPermitLimit: 120, defaultWindowSeconds: 60);
});
builder.Services.AddCors(options =>
{
    options.AddPolicy("Frontend", policy =>
    {
        policy
            .WithOrigins(GetAllowedOrigins(builder.Configuration))
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders =
        ForwardedHeaders.XForwardedFor |
        ForwardedHeaders.XForwardedProto |
        ForwardedHeaders.XForwardedHost;
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
});

builder.Services.AddDbContext<AppDbContext>((sp, o) =>
    o.UseNpgsql(sp.GetRequiredService<IConfiguration>().GetRequiredSecretValue("ConnectionStrings:Default")));

builder.Services
    .AddIdentityCore<ApplicationUser>(options =>
    {
        options.User.RequireUniqueEmail = true;
        options.Password.RequiredLength = 10;
        options.Password.RequireDigit = true;
        options.Password.RequireLowercase = true;
        options.Password.RequireUppercase = true;
        options.Password.RequireNonAlphanumeric = true;
        options.Lockout.AllowedForNewUsers = true;
        options.Lockout.MaxFailedAccessAttempts = builder.Configuration.GetValue("Auth:Lockout:MaxFailedAccessAttempts", 5);
        options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(builder.Configuration.GetValue("Auth:Lockout:Minutes", 15));
    })
    .AddRoles<IdentityRole<Guid>>()
    .AddEntityFrameworkStores<AppDbContext>()
    .AddDefaultTokenProviders();

var jwt = builder.Configuration.GetSection("Jwt").Get<JwtOptions>() ?? new JwtOptions();
jwt.SigningKey = builder.Configuration.GetRequiredSecretValue("Jwt:SigningKey");
var signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.SigningKey));
var auth = builder.Services
    .AddAuthentication(options =>
    {
        options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
        options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
    })
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwt.Issuer,
            ValidateAudience = true,
            ValidAudience = jwt.Audience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = signingKey,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromSeconds(30)
        };
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                if (!string.IsNullOrEmpty(accessToken) && context.HttpContext.Request.Path.StartsWithSegments("/hub"))
                    context.Token = accessToken;
                return Task.CompletedTask;
            }
        };
    })
    .AddCookie(AuthSchemes.External, options =>
    {
        options.Cookie.Name = "Sheshi.External";
        options.ExpireTimeSpan = TimeSpan.FromMinutes(10);
    });

var google = builder.Configuration.GetSection("Authentication:Google");
if (!string.IsNullOrWhiteSpace(google["ClientId"]) && !string.IsNullOrWhiteSpace(google["ClientSecret"]))
{
    auth.AddGoogle("google", options =>
    {
        options.SignInScheme = AuthSchemes.External;
        options.ClientId = google["ClientId"]!;
        options.ClientSecret = google["ClientSecret"]!;
    });
}

var microsoft = builder.Configuration.GetSection("Authentication:Microsoft");
if (!string.IsNullOrWhiteSpace(microsoft["ClientId"]) && !string.IsNullOrWhiteSpace(microsoft["ClientSecret"]))
{
    auth.AddMicrosoftAccount("microsoft", options =>
    {
        options.SignInScheme = AuthSchemes.External;
        options.ClientId = microsoft["ClientId"]!;
        options.ClientSecret = microsoft["ClientSecret"]!;
    });
}

var apple = builder.Configuration.GetSection("Authentication:Apple");
if (!string.IsNullOrWhiteSpace(apple["ClientId"]) &&
    !string.IsNullOrWhiteSpace(apple["TeamId"]) &&
    !string.IsNullOrWhiteSpace(apple["KeyId"]) &&
    !string.IsNullOrWhiteSpace(apple["PrivateKey"]))
{
    auth.AddApple("apple", options =>
    {
        options.SignInScheme = AuthSchemes.External;
        options.ClientId = apple["ClientId"]!;
        options.TeamId = apple["TeamId"]!;
        options.KeyId = apple["KeyId"]!;
        options.PrivateKey = (_, _) => Task.FromResult(apple["PrivateKey"]!.AsMemory());
    });
}

var app = builder.Build();

// Apply migrations in dev by default. Production can opt in with Database:AutoMigrate=true.
var startupLogger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("Startup");
try
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var autoMigrate = migrateOnly || app.Environment.IsDevelopment() || app.Configuration.GetValue<bool>("Database:AutoMigrate");
    if (autoMigrate)
    {
        await db.Database.MigrateAsync();
    }
    else
    {
        startupLogger.LogInformation("Skipping automatic database migrations. Set Database:AutoMigrate=true to opt in.");
    }

    await DbSeeder.SeedAsync(app.Services);
}
catch (Exception ex)
{
    startupLogger.LogError(ex, "Database migration or seed failed during startup.");
    throw;
}

if (migrateOnly)
{
    return;
}

// Configure the HTTP request pipeline.
// Catch-all so an unhandled exception never returns a raw stack trace / server paths to the
// client in ANY environment — structured 500 instead. (Defense in depth; fail closed.)
app.UseExceptionHandler(handler => handler.Run(async context =>
{
    context.Response.StatusCode = StatusCodes.Status500InternalServerError;
    context.Response.ContentType = "application/json";
    await context.Response.WriteAsJsonAsync(new { error = "INTERNAL_ERROR" });
}));

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

if (app.Configuration.GetValue<bool>("Proxy:TrustForwardedHeaders"))
{
    app.UseForwardedHeaders();
}

// Use the same (PostConfigured, absolute) options the image storage writes to, so serving and
// saving always point at the same directory.
var uploadPath = app.Services.GetRequiredService<Microsoft.Extensions.Options.IOptions<StorageOptions>>().Value.UploadPath;
Directory.CreateDirectory(uploadPath);
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(uploadPath),
    RequestPath = "/uploads"
});

app.UseHttpsRedirection();

app.UseRouting();
app.UseCors("Frontend");
app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();

app.MapControllers();
app.MapHub<ChatHub>("/hub");

app.MapGet("/health/live", () => "live");
app.MapGet("/health/ready", ReadinessChecks.CheckAsync);
app.MapGet("/health", () => "ok");

app.Run();

static string[] GetAllowedOrigins(IConfiguration configuration)
{
    var configured = configuration.GetSection("Cors:AllowedOrigins").Get<string[]>();
    if (configured is { Length: > 0 }) return configured.Where(o => !string.IsNullOrWhiteSpace(o)).ToArray();

    var raw = configuration["Cors:AllowedOrigins"];
    if (!string.IsNullOrWhiteSpace(raw))
        return raw.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);

    return
    [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "http://localhost:8081",
        "http://127.0.0.1:8081"
    ];
}

static void AddFixedPolicy(
    RateLimiterOptions options,
    IConfiguration configuration,
    string policyName,
    string configName,
    bool preferUser,
    int defaultPermitLimit,
    int defaultWindowSeconds)
{
    options.AddPolicy(policyName, context =>
    {
        var permitLimit = Math.Max(1, configuration.GetValue($"RateLimits:{configName}:PermitLimit", defaultPermitLimit));
        var windowSeconds = Math.Max(1, configuration.GetValue($"RateLimits:{configName}:WindowSeconds", defaultWindowSeconds));
        return RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: BuildPartitionKey(context, policyName, preferUser),
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = permitLimit,
                Window = TimeSpan.FromSeconds(windowSeconds),
                QueueLimit = 0,
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                AutoReplenishment = true
            });
    });
}

static string BuildPartitionKey(HttpContext context, string policyName, bool preferUser)
{
    var userId = preferUser ? context.User.GetUserId()?.ToString() : null;
    if (!string.IsNullOrWhiteSpace(userId)) return $"{policyName}:user:{userId}";

    var ip = context.Connection.RemoteIpAddress?.ToString();
    return $"{policyName}:ip:{ip ?? "unknown"}";
}

public partial class Program;
