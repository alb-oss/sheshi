namespace Sheshi.Api.Domain;
public class Message
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid RoomId { get; set; }
    public Room Room { get; set; } = null!;
    public Guid AuthorId { get; set; }
    public ApplicationUser Author { get; set; } = null!;
    public Guid? ParentId { get; set; }
    public Message? Parent { get; set; }
    public Guid RootMessageId { get; set; }
    public int Depth { get; set; }
    public string Body { get; set; } = "";
    public string? ImageUrl { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
