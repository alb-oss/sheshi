namespace Sheshi.Api.Domain;

public class ModerationFlag
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid MessageId { get; set; }
    public Message Message { get; set; } = null!;
    public Guid RoomId { get; set; }
    public Guid AuthorId { get; set; }
    public string RuleKey { get; set; } = "";
    public ModerationCategory Category { get; set; }
    public ModerationSeverity Severity { get; set; }
    public double Score { get; set; }
    public string Evidence { get; set; } = "";
    public ModerationFlagStatus Status { get; set; } = ModerationFlagStatus.Open;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public Guid? ResolvedById { get; set; }
    public DateTimeOffset? ResolvedAt { get; set; }
}
