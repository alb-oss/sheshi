namespace Sheshi.Api.Domain;
public class Room
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Slug { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    // Denormalized counters maintained on write so list/feed reads need no GROUP BY.
    public int ThreadCount { get; set; }
    public DateTimeOffset? LatestActivityAt { get; set; }
}
