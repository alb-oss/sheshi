namespace Sheshi.Api.Domain;

// One citizen's vote on a proposal. The composite PK (ProposalId, UserId) enforces one-vote-per-user at
// the database — there can be at most one row per user per proposal. +1 = PRO, -1 = KUNDËR; a proposal's
// net score = SUM(Value). A direct clone of Vote.cs (the message vote) so the proven atomic-upsert and
// concurrent-vote guarantees carry over unchanged.
public class ProposalVote
{
    public Guid ProposalId { get; set; }
    public Proposal Proposal { get; set; } = null!;
    public Guid UserId { get; set; }
    public ApplicationUser User { get; set; } = null!;
    public short Value { get; set; } = 1;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
