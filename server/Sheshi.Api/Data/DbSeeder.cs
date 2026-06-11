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
                EmailConfirmed = true, // operator-configured account, no inbox round-trip needed
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

        if (!user.EmailConfirmed)
        {
            user.EmailConfirmed = true;
            await userManager.UpdateAsync(user);
        }

        if (!await userManager.CheckPasswordAsync(user, password))
            await ResetConfiguredPasswordAsync(userManager, user, password);
    }

    private static async Task ResetConfiguredPasswordAsync(
        UserManager<ApplicationUser> userManager,
        ApplicationUser user,
        string password)
    {
        var token = await userManager.GeneratePasswordResetTokenAsync(user);
        var reset = await userManager.ResetPasswordAsync(user, token, password);
        if (!reset.Succeeded)
            throw new InvalidOperationException("Seed admin password reset failed: " +
                                                string.Join("; ", reset.Errors.Select(e => e.Description)));
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
