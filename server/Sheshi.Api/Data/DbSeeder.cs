using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Sheshi.Api.Domain;
namespace Sheshi.Api.Data;

public static class DbSeeder
{
    // Keep the default surface deliberately small; more rooms should be product-managed, not auto-seeded.
    private static readonly (string Slug, string Name, string Description)[] SeedRooms =
    [
        ("sheshi", "#sheshi", "Diskutimi kryesor publik."),
    ];

    private static readonly string[] LegacySeedRoomSlugs =
    [
        "vjosa-narta",
        "tirana",
        "shkodra",
        "korca"
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
        var legacyRooms = await db.Rooms
            .Where(r => LegacySeedRoomSlugs.Contains(r.Slug))
            .ToListAsync();
        db.Rooms.RemoveRange(legacyRooms);

        foreach (var (slug, name, description) in SeedRooms)
        {
            var room = await db.Rooms.SingleOrDefaultAsync(r => r.Slug == slug);
            if (room is null)
            {
                db.Rooms.Add(new Room { Slug = slug, Name = name, Description = description });
            }
            else
            {
                room.Name = name;
                room.Description = description;
            }
        }
        await db.SaveChangesAsync();

        await SeedConfiguredAdminAsync(sp);
    }

    private static async Task SeedConfiguredAdminAsync(IServiceProvider sp)
    {
        var configuration = sp.GetRequiredService<IConfiguration>();
        var email = configuration["SeedAdmin:Email"]?.Trim().ToLowerInvariant();
        var password = configuration["SeedAdmin:Password"];
        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password)) return;

        var userManager = sp.GetRequiredService<UserManager<ApplicationUser>>();
        var user = await userManager.FindByEmailAsync(email);
        if (user is null)
        {
            user = new ApplicationUser
            {
                Id = Guid.NewGuid(),
                Email = email,
                UserName = await CreateAvailableUsernameAsync(userManager, email),
                DisplayName = string.IsNullOrWhiteSpace(configuration["SeedAdmin:DisplayName"])
                    ? "Sheshi Admin"
                    : configuration["SeedAdmin:DisplayName"]!.Trim()
            };

            var created = await userManager.CreateAsync(user, password);
            if (!created.Succeeded)
                throw new InvalidOperationException("Seed admin creation failed: " +
                                                    string.Join("; ", created.Errors.Select(e => e.Description)));
        }

        foreach (var role in new[] { Roles.User, Roles.Admin })
        {
            if (!await userManager.IsInRoleAsync(user, role))
                await userManager.AddToRoleAsync(user, role);
        }
    }

    private static async Task<string> CreateAvailableUsernameAsync(
        UserManager<ApplicationUser> userManager,
        string email)
    {
        var local = new string(email.Split('@')[0]
            .Select(c => char.IsLetterOrDigit(c) || c == '_' ? c : '_')
            .ToArray()).Trim('_').ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(local)) local = "admin";

        var candidate = local;
        var suffix = 1;
        while (await userManager.FindByNameAsync(candidate) is not null)
        {
            candidate = $"{local}_{suffix}";
            suffix++;
        }

        return candidate;
    }
}
