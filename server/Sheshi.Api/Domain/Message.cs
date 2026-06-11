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

    // Denormalized counters maintained on write (direct non-deleted replies, votes).
    public int ReplyCount { get; set; }
    public int VoteCount { get; set; }

    // Thread root: legacy top-level rows stored Guid.Empty before RootMessageId
    // existed, so a root with no parent resolves to its own id.
    public Guid EffectiveRootId => RootMessageId == Guid.Empty && ParentId is null ? Id : RootMessageId;
}
