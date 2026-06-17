namespace Sheshi.Api.Domain;

// A civic proposal ("kërkesë"): a titled demand citizens vote PRO/KUNDËR on. Submitted as Pending
// (hidden from the public feed), published by a moderator into the open list, then promoted to Approved
// by a supermajority vote that clears quorum. Score/Pro/Kunder are NOT stored — they are aggregated from
// ProposalVote at read time (like Message.Score). Status + ApprovedAt ARE persisted, because the
// promotion is a one-way, audited side-effect, not a recomputable view of the votes.
public class Proposal
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid AuthorId { get; set; }
    public ApplicationUser Author { get; set; } = null!;
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
    public ProposalCategory Category { get; set; }
    public ProposalStatus Status { get; set; } = ProposalStatus.Pending;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? PublishedAt { get; set; }
    public DateTimeOffset? ApprovedAt { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
}
