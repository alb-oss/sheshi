using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.

builder.Services.AddControllers();
// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();

builder.Services.AddDbContext<AppDbContext>(o =>
    o.UseNpgsql(builder.Configuration.GetConnectionString("Default")));

// Minimal Identity registration so roles can be managed/seeded.
// Full Identity + JWT wiring (token providers, etc.) is expanded in Phase 2.
builder.Services
    .AddIdentityCore<ApplicationUser>()
    .AddRoles<IdentityRole<Guid>>()
    .AddEntityFrameworkStores<AppDbContext>();

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

app.UseHttpsRedirection();

app.UseAuthorization();

app.MapControllers();

app.MapGet("/health", () => "ok");

app.Run();

public partial class Program;
