using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Sheshi.Api.Domain;
namespace Sheshi.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options)
    : IdentityDbContext<ApplicationUser, IdentityRole<Guid>, Guid>(options)
{
    public DbSet<Room> Rooms => Set<Room>();
    public DbSet<Message> Messages => Set<Message>();
    public DbSet<Vote> Votes => Set<Vote>();
    public DbSet<Report> Reports => Set<Report>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b);

        b.Entity<ApplicationUser>(e => e.HasIndex(u => u.UserName).IsUnique());

        b.Entity<Room>(e => { e.HasIndex(r => r.Slug).IsUnique(); });

        b.Entity<Message>(e =>
        {
            e.Property(m => m.Body).HasMaxLength(2000);
            e.HasOne(m => m.Room).WithMany().HasForeignKey(m => m.RoomId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(m => m.Author).WithMany().HasForeignKey(m => m.AuthorId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(m => m.Parent).WithMany().HasForeignKey(m => m.ParentId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(m => new { m.RoomId, m.CreatedAt }).IsDescending(false, true).HasFilter("\"ParentId\" IS NULL");
            e.HasIndex(m => m.ParentId);
        });

        b.Entity<Vote>(e =>
        {
            e.HasKey(v => new { v.MessageId, v.UserId });
            e.HasOne(v => v.Message).WithMany().HasForeignKey(v => v.MessageId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(v => v.User).WithMany().HasForeignKey(v => v.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Report>(e =>
        {
            e.Property(r => r.Note).HasMaxLength(500);
            e.HasOne(r => r.Message).WithMany().HasForeignKey(r => r.MessageId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(r => r.Reporter).WithMany().HasForeignKey(r => r.ReporterId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<RefreshToken>(e => { e.HasIndex(t => t.TokenHash); e.HasIndex(t => t.UserId); });
    }
}
