using FluentAssertions;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Tests;

// DbSeeder runs on startup (after migrations): it seeds the three Identity roles, upserts the single
// default "#sheshi" room, removes legacy auto-seeded rooms, and creates a configured admin when
// SeedAdmin:* is set. SeedAdminTests already covers admin creation; these cover the rest by invoking
// DbSeeder.SeedAsync directly against the live Testcontainers DB — the role seeding, the room upsert,
// idempotency (a re-seed must not duplicate the default room), and the legacy-room cleanup.
public class DbSeederTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Seeds_the_three_identity_roles()
    {
        using var scope = factory.Services.CreateScope();
        var roleManager = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<Guid>>>();
        foreach (var role in new[] { Roles.User, Roles.Moderator, Roles.Admin })
            (await roleManager.RoleExistsAsync(role)).Should().BeTrue($"role '{role}' should be seeded");
    }

    [Fact]
    public async Task Seeds_the_default_sheshi_room_with_expected_fields()
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var room = await db.Rooms.AsNoTracking().SingleOrDefaultAsync(r => r.Slug == "sheshi");
        room.Should().NotBeNull();
        room!.Name.Should().Be("#sheshi");
        room.Description.Should().Be("Diskutimi kryesor publik.");
    }

    [Fact]
    public async Task Re_seeding_is_idempotent_and_never_duplicates_the_default_room()
    {
        // Startup already seeded once; seeding again must upsert (by slug), not insert a duplicate.
        await DbSeeder.SeedAsync(factory.Services);
        await DbSeeder.SeedAsync(factory.Services);

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        (await db.Rooms.CountAsync(r => r.Slug == "sheshi")).Should().Be(1);
    }

    [Fact]
    public async Task Removes_legacy_seed_rooms_on_seed()
    {
        // Simulate a leftover from the old multi-room auto-seed, then re-seed and prove it's cleaned up
        // (a real invariant: legacy rooms must not silently linger).
        using (var arrange = factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<AppDbContext>();
            if (!await db.Rooms.AnyAsync(r => r.Slug == "tirana"))
            {
                db.Rooms.Add(new Room { Slug = "tirana", Name = "#tirana", Description = "legacy" });
                await db.SaveChangesAsync();
            }
        }

        await DbSeeder.SeedAsync(factory.Services);

        using var assert = factory.Services.CreateScope();
        var assertDb = assert.ServiceProvider.GetRequiredService<AppDbContext>();
        (await assertDb.Rooms.AnyAsync(r => r.Slug == "tirana"))
            .Should().BeFalse("legacy auto-seeded rooms are removed on seed");
        // The default room survives the same pass.
        (await assertDb.Rooms.AnyAsync(r => r.Slug == "sheshi")).Should().BeTrue();
    }
}
