using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;
using Sheshi.Api.Features.Messages;

namespace Sheshi.Api.Features.Proposals;

// Reads/writes for civic proposals. Mirrors MessageService: AsNoTracking reads, batch enrichment with
// GetValueOrDefault, and the atomic ON CONFLICT vote upsert. The promotion to Approved is decided here
// against DB-truth tallies (never the caller's optimistic value) and committed with a conditional UPDATE
// so concurrent crossing votes can't double-fire the approval.
public class ProposalService(AppDbContext db, IOptions<ProposalApprovalOptions> approvalOptions)
{
    private readonly ProposalApprovalOptions _approval = approvalOptions.Value;

    public async Task<IReadOnlyList<ProposalDto>> ListAsync(
        ProposalStatus status, ProposalCategory? category, Guid? callerId, int limit, CancellationToken ct = default)
    {
        var query = db.Proposals.AsNoTracking().Where(p => p.Status == status && p.DeletedAt == null);
        if (category is not null) query = query.Where(p => p.Category == category);

        // Pull a bounded candidate set newest-first (the score is an aggregate, so it can't be ordered in
        // SQL without a join), enrich, then rank in memory — the same shape the moderation list uses.
        var rows = await query.OrderByDescending(p => p.CreatedAt).Take(500).ToListAsync(ct);
        var dtos = await EnrichAsync(rows, callerId, ct);

        IEnumerable<ProposalDto> ranked = status == ProposalStatus.Approved
            ? dtos.OrderByDescending(d => d.ApprovedAt)
            : dtos.OrderByDescending(d => d.Score).ThenByDescending(d => d.CreatedAt);

        return ranked.Take(Math.Clamp(limit, 1, 100)).ToList();
    }

    public async Task<IReadOnlyList<ProposalDto>> ListQueueAsync(
        ProposalCategory? category, int limit, CancellationToken ct = default)
    {
        var query = db.Proposals.AsNoTracking().Where(p => p.Status == ProposalStatus.Pending && p.DeletedAt == null);
        if (category is not null) query = query.Where(p => p.Category == category);

        // Oldest-first: a review queue is FIFO.
        var rows = await query.OrderBy(p => p.CreatedAt).Take(Math.Clamp(limit, 1, 100)).ToListAsync(ct);
        return await EnrichAsync(rows, null, ct);
    }

    public async Task<ProposalDto?> GetAsync(Guid id, Guid? callerId, CancellationToken ct = default)
    {
        var proposal = await db.Proposals.AsNoTracking()
            .SingleOrDefaultAsync(p => p.Id == id && p.DeletedAt == null, ct);
        return proposal is null ? null : (await EnrichAsync([proposal], callerId, ct)).Single();
    }

    public async Task<ProposalDto> CreateAsync(Guid authorId, CreateProposalRequest request, CancellationToken ct = default)
    {
        var proposal = new Proposal
        {
            AuthorId = authorId,
            Title = request.Title.Trim(),
            Body = request.Body.Trim(),
            Category = request.Category,
            Status = ProposalStatus.Pending,
        };
        db.Proposals.Add(proposal);
        await db.SaveChangesAsync(ct);
        return (await EnrichAsync([proposal], authorId, ct)).Single();
    }

    // Returns an error code or null on success. Edits are allowed only before anyone has voted, so a
    // proposal can't be swapped out from under people who already supported it.
    public async Task<string?> EditAsync(Guid id, Guid authorId, EditProposalRequest request, CancellationToken ct = default)
    {
        var proposal = await db.Proposals.SingleOrDefaultAsync(p => p.Id == id && p.DeletedAt == null, ct);
        if (proposal is null) return "NOT_FOUND";
        if (proposal.AuthorId != authorId) return "FORBIDDEN";
        if (proposal.Status is not (ProposalStatus.Pending or ProposalStatus.Proposed)) return "NOT_EDITABLE";
        if (await db.ProposalVotes.AnyAsync(v => v.ProposalId == id, ct)) return "HAS_VOTES";

        proposal.Title = request.Title.Trim();
        proposal.Body = request.Body.Trim();
        await db.SaveChangesAsync(ct);
        return null;
    }

    public async Task<string?> WithdrawAsync(Guid id, Guid authorId, CancellationToken ct = default)
    {
        var proposal = await db.Proposals.SingleOrDefaultAsync(p => p.Id == id && p.DeletedAt == null, ct);
        if (proposal is null) return "NOT_FOUND";
        if (proposal.AuthorId != authorId) return "FORBIDDEN";
        // An Approved demand is a settled civic outcome — the author can't retract it.
        if (proposal.Status is not (ProposalStatus.Pending or ProposalStatus.Proposed)) return "NOT_WITHDRAWABLE";

        proposal.DeletedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return null;
    }

    public async Task<ProposalVoteResult> VoteAsync(Guid id, Guid userId, int value, CancellationToken ct = default)
    {
        var proposal = await db.Proposals.AsNoTracking()
            .SingleOrDefaultAsync(p => p.Id == id && p.DeletedAt == null, ct);
        if (proposal is null) return ProposalVoteResult.Failed("NOT_FOUND");
        // Voting is open only while a proposal is published and not yet decided.
        if (proposal.Status != ProposalStatus.Proposed) return ProposalVoteResult.Failed("NOT_OPEN");

        if (value == 0)
        {
            await db.Database.ExecuteSqlAsync(
                $@"DELETE FROM ""ProposalVotes"" WHERE ""ProposalId"" = {id} AND ""UserId"" = {userId}", ct);
        }
        else
        {
            var val = (short)value;
            var now = DateTimeOffset.UtcNow;
            // Atomic upsert: a concurrent double-tap collapses onto DO UPDATE instead of racing two
            // INSERTs into the (ProposalId, UserId) PK (the 23505→500 bug already fixed for messages).
            await db.Database.ExecuteSqlAsync(
                $@"INSERT INTO ""ProposalVotes"" (""ProposalId"", ""UserId"", ""Value"", ""CreatedAt"")
                   VALUES ({id}, {userId}, {val}, {now})
                   ON CONFLICT (""ProposalId"", ""UserId"")
                   DO UPDATE SET ""Value"" = EXCLUDED.""Value""", ct);
        }

        var pro = await db.ProposalVotes.CountAsync(v => v.ProposalId == id && v.Value == 1, ct);
        var kunder = await db.ProposalVotes.CountAsync(v => v.ProposalId == id && v.Value == -1, ct);
        var total = pro + kunder;
        var score = pro - kunder;

        var approved = false;
        if (total >= _approval.MinQuorum && total > 0 && (double)pro / total >= _approval.MinRatio)
        {
            // Conditional UPDATE: only the call that actually flips Proposed→Approved gets rows>0, so the
            // approval event fires exactly once even under concurrent crossing votes.
            var approvedAt = DateTimeOffset.UtcNow;
            var rows = await db.Database.ExecuteSqlAsync(
                $@"UPDATE ""Proposals"" SET ""Status"" = 'Approved', ""ApprovedAt"" = {approvedAt}
                   WHERE ""Id"" = {id} AND ""Status"" = 'Proposed'", ct);
            approved = rows > 0;
        }

        return ProposalVoteResult.Ok(score, pro, kunder, approved);
    }

    public async Task<ProposalReviewResult> ReviewAsync(Guid id, string action, CancellationToken ct = default)
    {
        var proposal = await db.Proposals.SingleOrDefaultAsync(p => p.Id == id && p.DeletedAt == null, ct);
        if (proposal is null) return ProposalReviewResult.Failed("NOT_FOUND");
        if (proposal.Status != ProposalStatus.Pending) return ProposalReviewResult.Failed("NOT_PENDING");

        switch (action)
        {
            case "publish":
                proposal.Status = ProposalStatus.Proposed;
                proposal.PublishedAt = DateTimeOffset.UtcNow;
                break;
            case "reject":
                proposal.Status = ProposalStatus.Rejected;
                break;
            default:
                return ProposalReviewResult.Failed("INVALID_ACTION");
        }

        await db.SaveChangesAsync(ct);
        var dto = (await EnrichAsync([proposal], null, ct)).Single();
        return ProposalReviewResult.Ok(proposal, dto);
    }

    public async Task<string?> CloseAsync(Guid id, CancellationToken ct = default)
    {
        var proposal = await db.Proposals.SingleOrDefaultAsync(p => p.Id == id && p.DeletedAt == null, ct);
        if (proposal is null) return "NOT_FOUND";
        proposal.DeletedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return null;
    }

    private async Task<IReadOnlyList<ProposalDto>> EnrichAsync(
        IReadOnlyList<Proposal> proposals, Guid? callerId, CancellationToken ct)
    {
        if (proposals.Count == 0) return [];

        var ids = proposals.Select(p => p.Id).ToArray();
        var authorIds = proposals.Select(p => p.AuthorId).Distinct().ToArray();

        var authors = await db.Users
            .AsNoTracking()
            .Where(u => authorIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => new AuthorDto(u.Id, u.UserName, u.DisplayName, u.AvatarUrl), ct);

        var pro = await db.ProposalVotes
            .AsNoTracking()
            .Where(v => ids.Contains(v.ProposalId) && v.Value == 1)
            .GroupBy(v => v.ProposalId)
            .Select(g => new { ProposalId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.ProposalId, x => x.Count, ct);

        var kunder = await db.ProposalVotes
            .AsNoTracking()
            .Where(v => ids.Contains(v.ProposalId) && v.Value == -1)
            .GroupBy(v => v.ProposalId)
            .Select(g => new { ProposalId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.ProposalId, x => x.Count, ct);

        var myVotes = callerId is null
            ? new Dictionary<Guid, int>()
            : await db.ProposalVotes
                .AsNoTracking()
                .Where(v => v.UserId == callerId && ids.Contains(v.ProposalId))
                .Select(v => new { v.ProposalId, Value = (int)v.Value })
                .ToDictionaryAsync(x => x.ProposalId, x => x.Value, ct);

        return proposals.Select(p =>
        {
            var proCount = pro.GetValueOrDefault(p.Id);
            var kunderCount = kunder.GetValueOrDefault(p.Id);
            return new ProposalDto(
                p.Id,
                p.Title,
                p.Body,
                p.Category,
                p.Status,
                p.AuthorId,
                authors.GetValueOrDefault(p.AuthorId),
                proCount - kunderCount,
                proCount,
                kunderCount,
                myVotes.GetValueOrDefault(p.Id),
                p.CreatedAt,
                p.PublishedAt,
                p.ApprovedAt);
        }).ToList();
    }
}

// Tunable promotion thresholds (config section "ProposalApproval"). A proposal becomes Approved when the
// PRO share clears MinRatio AND total votes clear MinQuorum — the quorum stops a 3–0 from flipping.
public sealed class ProposalApprovalOptions
{
    public double MinRatio { get; set; } = 0.60;
    public int MinQuorum { get; set; } = 100;
}

public sealed record ProposalVoteResult(string? Error, int Score, int Pro, int Kunder, bool Approved)
{
    public static ProposalVoteResult Ok(int score, int pro, int kunder, bool approved) => new(null, score, pro, kunder, approved);
    public static ProposalVoteResult Failed(string error) => new(error, 0, 0, 0, false);
}

public sealed record ProposalReviewResult(string? Error, Proposal? Entity, ProposalDto? Dto)
{
    public static ProposalReviewResult Ok(Proposal entity, ProposalDto dto) => new(null, entity, dto);
    public static ProposalReviewResult Failed(string error) => new(error, null, null);
}
