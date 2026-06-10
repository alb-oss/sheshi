using System.Net;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using AspNet.Security.OAuth.Apple;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.IdentityModel.Tokens;
using Sheshi.Api.Auth;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;
using Sheshi.Api.Email;
using Sheshi.Api.Features.Messages;
using Sheshi.Api.Features.Rooms;
using Sheshi.Api.Realtime;
using Sheshi.Api.Storage;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(o => o.AddServerHeader = false);

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
builder.Services.Configure<StorageOptions>(builder.Configuration.GetSection("Storage"));
builder.Services.AddScoped<TokenService>();
builder.Services.AddScoped<IEmailSender, SmtpEmailSender>();
builder.Services.AddScoped<MessageService>();
builder.Services.AddScoped<RoomService>();
builder.Services.AddScoped<IImageStorage, LocalFileImageStorage>();
builder.Services.AddSingleton<PresenceTracker>();
builder.Services.AddScoped<RealtimeNotifier>();
builder.Services.AddSignalR();
var authPermitLimit = GetConfiguredLimit(builder.Configuration, "RateLimits:AuthPerMinute", builder.Environment.IsDevelopment() ? 1000 : 20);
var readPermitLimit = GetConfiguredLimit(builder.Configuration, "RateLimits:ReadsPerMinute", builder.Environment.IsDevelopment() ? 5000 : 600);
var writePermitLimit = GetConfiguredLimit(builder.Configuration, "RateLimits:WritesPerMinute", builder.Environment.IsDevelopment() ? 1000 : 90);
var realtimePermitLimit = GetConfiguredLimit(builder.Configuration, "RateLimits:RealtimeConnectsPerMinute", builder.Environment.IsDevelopment() ? 1000 : 120);
var moderationPermitLimit = GetConfiguredLimit(builder.Configuration, "RateLimits:ModerationPerMinute", builder.Environment.IsDevelopment() ? 1000 : 120);
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.OnRejected = async (context, ct) =>
    {
        context.HttpContext.Response.Headers.RetryAfter = "60";
        await context.HttpContext.Response.WriteAsJsonAsync(new { error = "RATE_LIMITED" }, cancellationToken: ct);
    };
    options.AddPolicy("auth", context => RateLimitPartition.GetFixedWindowLimiter(
        GetRateLimitKey(context),
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = authPermitLimit,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        }));
    options.AddPolicy("reads", context => RateLimitPartition.GetFixedWindowLimiter(
        GetRateLimitKey(context),
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = readPermitLimit,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        }));
    options.AddPolicy("writes", context => RateLimitPartition.GetFixedWindowLimiter(
        GetRateLimitKey(context),
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = writePermitLimit,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        }));
    options.AddPolicy("realtime", context => RateLimitPartition.GetFixedWindowLimiter(
        GetRateLimitKey(context),
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = realtimePermitLimit,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        }));
    options.AddPolicy("moderation", context => RateLimitPartition.GetFixedWindowLimiter(
        GetRateLimitKey(context),
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = moderationPermitLimit,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        }));
});
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor |
                               ForwardedHeaders.XForwardedProto |
                               ForwardedHeaders.XForwardedHost;
    options.ForwardLimit = builder.Configuration.GetValue<int?>("LoadBalancer:ForwardLimit") ?? 2;

    foreach (var proxy in builder.Configuration.GetSection("LoadBalancer:KnownProxies").Get<string[]>() ?? [])
    {
        if (IPAddress.TryParse(proxy, out var address)) options.KnownProxies.Add(address);
    }
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

builder.Services.AddDbContext<AppDbContext>(o =>
    o.UseNpgsql(builder.Configuration.GetConnectionString("Default")));

builder.Services
    .AddIdentityCore<ApplicationUser>(options =>
    {
        options.User.RequireUniqueEmail = true;
        options.Password.RequiredLength = 6;
        options.Password.RequireNonAlphanumeric = false;
        options.Password.RequireUppercase = !builder.Environment.IsDevelopment();
    })
    .AddRoles<IdentityRole<Guid>>()
    .AddEntityFrameworkStores<AppDbContext>()
    .AddDefaultTokenProviders();

var jwt = builder.Configuration.GetSection("Jwt").Get<JwtOptions>() ?? new JwtOptions();
ValidateJwtOptions(jwt, builder.Environment);
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
    var autoMigrate = app.Environment.IsDevelopment() || app.Configuration.GetValue<bool>("Database:AutoMigrate");
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

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}
else
{
    app.UseHsts();
}

var storage = app.Services.GetRequiredService<IConfiguration>().GetSection("Storage").Get<StorageOptions>() ?? new StorageOptions();
var uploadPath = Path.GetFullPath(storage.UploadPath);
Directory.CreateDirectory(uploadPath);
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(uploadPath),
    RequestPath = "/uploads"
});

if (app.Configuration.GetValue<bool>("LoadBalancer:UseForwardedHeaders"))
    app.UseForwardedHeaders();

app.Use(async (context, next) =>
{
    var headers = context.Response.Headers;
    headers.TryAdd("X-Content-Type-Options", "nosniff");
    headers.TryAdd("X-Frame-Options", "DENY");
    headers.TryAdd("Referrer-Policy", "no-referrer");
    headers.TryAdd("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    headers.TryAdd("Cross-Origin-Opener-Policy", "same-origin");
    headers.TryAdd("Cross-Origin-Resource-Policy", "same-site");
    headers.TryAdd("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    await next();
});

app.UseHttpsRedirection();
app.UseRouting();
app.UseCors("Frontend");
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHub<ChatHub>("/hub").RequireRateLimiting("realtime");

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
        "http://127.0.0.1:8080"
    ];
}

static int GetConfiguredLimit(IConfiguration configuration, string key, int fallback) =>
    Math.Max(1, configuration.GetValue<int?>(key) ?? fallback);

static void ValidateJwtOptions(JwtOptions jwt, IWebHostEnvironment environment)
{
    if (string.IsNullOrWhiteSpace(jwt.Issuer) || string.IsNullOrWhiteSpace(jwt.Audience))
        throw new InvalidOperationException("Jwt:Issuer and Jwt:Audience must be configured.");

    if (string.IsNullOrWhiteSpace(jwt.SigningKey) || Encoding.UTF8.GetByteCount(jwt.SigningKey) < 32)
        throw new InvalidOperationException("Jwt:SigningKey must be at least 32 bytes.");

    if (!environment.IsDevelopment() && jwt.SigningKey == "local_dev_signing_key_change_me_min_32_bytes")
        throw new InvalidOperationException("Jwt:SigningKey must be replaced outside Development.");
}

static string GetRateLimitKey(HttpContext context)
{
    var userId = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
    if (!string.IsNullOrWhiteSpace(userId)) return $"user:{userId}";

    return $"ip:{context.Connection.RemoteIpAddress?.ToString() ?? "unknown"}";
}

public partial class Program;
