using Sheshi.Api.Domain;
using Sheshi.Api.Features.Messages;

namespace Sheshi.Api.Features.Proposals;

// Score/Pro/Kunder are aggregated server-side (GetValueOrDefault → always an int on the wire); MyVote is
// the caller's own vote (-1/0/1), 0 for anonymous. Author may be null if the user row vanished. Snake_case
// on the wire via the global JSON policy, so these map 1:1 to the TS Proposal interface.
public record ProposalDto(
    Guid Id,
    string Title,
    string Body,
    ProposalCategory Category,
    ProposalStatus Status,
    Guid AuthorId,
    AuthorDto? Author,
    int Score,
    int Pro,
    int Kunder,
    int MyVote,
    DateTimeOffset CreatedAt,
    DateTimeOffset? PublishedAt,
    DateTimeOffset? ApprovedAt);

public record CreateProposalRequest(string Title, string Body, ProposalCategory Category);

public record EditProposalRequest(string Title, string Body);

public record VoteProposalRequest(int Value);

// action is "publish" or "reject" — the moderator's decision on a Pending proposal.
public record ReviewProposalRequest(string Action);

// Query-string filters for GET /api/proposals (and the moderator queue). Single-word keys bind
// case-insensitively, so no [FromQuery(Name=...)] is needed; category/status are parsed against the
// enums in the controller so unknown values fail closed with a structured error.
public record ProposalListQuery
{
    public string Status { get; init; } = "proposed";
    public string? Category { get; init; }
    public int Limit { get; init; } = 50;
}
