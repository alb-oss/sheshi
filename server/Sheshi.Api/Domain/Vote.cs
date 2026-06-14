namespace Sheshi.Api.Domain;
public class Vote
{
    public Guid MessageId { get; set; }
    public Message Message { get; set; } = null!;
    public Guid UserId { get; set; }
    public ApplicationUser User { get; set; } = null!;
    // +1 upvote, -1 downvote. A message's net score = SUM(Value) over its votes.
    public short Value { get; set; } = 1;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
