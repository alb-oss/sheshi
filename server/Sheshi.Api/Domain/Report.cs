namespace Sheshi.Api.Domain;
public class Report
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid MessageId { get; set; }
    public Message Message { get; set; } = null!;
    public Guid ReporterId { get; set; }
    public ApplicationUser Reporter { get; set; } = null!;
    public ReportReason Reason { get; set; }
    public string? Note { get; set; }
    public ReportStatus Status { get; set; } = ReportStatus.Open;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    // Set when the report leaves the Open state, so resolution time is measurable.
    public DateTimeOffset? ResolvedAt { get; set; }
}
