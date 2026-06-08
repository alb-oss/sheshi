using Microsoft.AspNetCore.Identity;
namespace Sheshi.Api.Domain;
public class ApplicationUser : IdentityUser<Guid>
{
    public string? DisplayName { get; set; }
    public string? AvatarUrl { get; set; }
    public DateTimeOffset? BannedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public bool IsBanned => BannedAt != null;
}
