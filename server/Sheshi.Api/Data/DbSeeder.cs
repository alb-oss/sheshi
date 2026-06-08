using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Sheshi.Api.Domain;
namespace Sheshi.Api.Data;

public static class DbSeeder
{
    // Exact slug/name/description strings ported from supabase/migrations.
    private static readonly (string Slug, string Name, string Description)[] SeedRooms =
    [
        ("sheshi", "#sheshi", "Sheshi qendror — diskutim i përgjithshëm qytetar."),
        ("vjosa-narta", "#vjosa-narta", "Mbrojtja e Vjosës dhe Nartës."),
        ("tirana", "#tirana", "Çështje qytetare në Tiranë."),
        ("shkodra", "#shkodra", "Çështje qytetare në Shkodër."),
        ("korca", "#korca", "Çështje qytetare në Korçë."),
    ];

    public static async Task SeedAsync(IServiceProvider services)
    {
        using var scope = services.CreateScope();
        var sp = scope.ServiceProvider;

        var roleManager = sp.GetRequiredService<RoleManager<IdentityRole<Guid>>>();
        foreach (var role in new[] { Roles.User, Roles.Moderator, Roles.Admin })
        {
            if (!await roleManager.RoleExistsAsync(role))
                await roleManager.CreateAsync(new IdentityRole<Guid>(role));
        }

        var db = sp.GetRequiredService<AppDbContext>();
        foreach (var (slug, name, description) in SeedRooms)
        {
            if (!await db.Rooms.AnyAsync(r => r.Slug == slug))
                db.Rooms.Add(new Room { Slug = slug, Name = name, Description = description });
        }
        await db.SaveChangesAsync();
    }
}
