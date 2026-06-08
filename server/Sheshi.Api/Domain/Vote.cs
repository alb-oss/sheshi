namespace Sheshi.Api.Domain;
public class Vote
{
    public Guid MessageId { get; set; }
    public Guid UserId { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
