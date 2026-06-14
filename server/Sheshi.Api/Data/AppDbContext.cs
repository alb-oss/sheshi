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
    public DbSet<ModerationAction> ModerationActions => Set<ModerationAction>();
    public DbSet<ModerationFlag> ModerationFlags => Set<ModerationFlag>();

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
            // Existing rows predate downvotes — they were all upvotes, so default to +1.
            e.Property(v => v.Value).HasDefaultValue((short)1);
            e.ToTable(t => t.HasCheckConstraint("CK_Votes_Value", "\"Value\" IN (-1, 1)"));
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

        b.Entity<ModerationAction>(e =>
        {
            e.Property(a => a.ActionType).HasMaxLength(80);
            e.Property(a => a.TargetType).HasMaxLength(80);
            e.Property(a => a.Reason).HasMaxLength(500);
            e.HasIndex(a => a.CreatedAt);
            e.HasIndex(a => new { a.TargetType, a.TargetId });
        });

        b.Entity<ModerationFlag>(e =>
        {
            e.Property(f => f.RuleKey).HasMaxLength(120);
            e.Property(f => f.Evidence).HasMaxLength(500);
            e.HasOne(f => f.Message).WithMany().HasForeignKey(f => f.MessageId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Room>().WithMany().HasForeignKey(f => f.RoomId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<ApplicationUser>().WithMany().HasForeignKey(f => f.AuthorId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<ApplicationUser>().WithMany().HasForeignKey(f => f.ResolvedById).OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(f => new { f.Status, f.CreatedAt });
            e.HasIndex(f => new { f.MessageId, f.RuleKey }).IsUnique();
            e.HasIndex(f => new { f.RoomId, f.Status });
            e.HasIndex(f => new { f.AuthorId, f.Status });
        });
    }
}
