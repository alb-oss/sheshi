using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using AspNet.Security.OAuth.Apple;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.IdentityModel.Tokens;
using Sheshi.Api.Auth;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;
using Sheshi.Api.Email;
using Sheshi.Api.Features.Messages;
using Sheshi.Api.Realtime;
using Sheshi.Api.Storage;

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
builder.Services.Configure<StorageOptions>(builder.Configuration.GetSection("Storage"));
builder.Services.AddScoped<TokenService>();
builder.Services.AddScoped<IEmailSender, SmtpEmailSender>();
builder.Services.AddScoped<MessageService>();
builder.Services.AddScoped<IImageStorage, LocalFileImageStorage>();
builder.Services.AddSingleton<PresenceTracker>();
builder.Services.AddScoped<RealtimeNotifier>();
builder.Services.AddSignalR();
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
    })
    .AddRoles<IdentityRole<Guid>>()
    .AddEntityFrameworkStores<AppDbContext>()
    .AddDefaultTokenProviders();

var jwt = builder.Configuration.GetSection("Jwt").Get<JwtOptions>() ?? new JwtOptions();
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

// Apply migrations and seed roles/rooms on startup.
var startupLogger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("Startup");
try
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await db.Database.MigrateAsync();
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

var storage = app.Services.GetRequiredService<IConfiguration>().GetSection("Storage").Get<StorageOptions>() ?? new StorageOptions();
var uploadPath = Path.GetFullPath(storage.UploadPath);
Directory.CreateDirectory(uploadPath);
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(uploadPath),
    RequestPath = "/uploads"
});

app.UseHttpsRedirection();

app.UseCors("Frontend");
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHub<ChatHub>("/hub");

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

public partial class Program;
