import type { QueryClient } from "@tanstack/react-query";

// Cache patchers for proposals — the proposal analog of applyVoteToCaches. The React Query cache is the
// single source of truth for the proposal lists; these walk every cached query, find the proposal by id,
// and apply an immutable update (no-op where nothing changes, so unrelated queries don't re-render).
//
// Proposals are matched on having BOTH `my_vote` and `pro` — a MessageRow has `my_vote` but no `pro`, so
// the message patchers and these never touch each other's nodes.

type ProposalNode = Record<string, unknown>;

// Optimistic delta write: set the caller's vote to nextVote, adjusting score/pro/kunder by the delta from
// the current vote. Used for the optimistic click AND the rollback (passing the last confirmed vote
// reverses it exactly, because the delta is computed live).
export function applyProposalVoteToCaches(qc: QueryClient, proposalId: string, nextVote: number) {
  patchAll(qc, proposalId, (p) => {
    const prev = (p.my_vote as number) ?? 0;
    if (prev === nextVote) return null;
    return {
      ...p,
      my_vote: nextVote,
      score: ((p.score as number) ?? 0) + (nextVote - prev),
      pro: ((p.pro as number) ?? 0) + (nextVote === 1 ? 1 : 0) - (prev === 1 ? 1 : 0),
      kunder: ((p.kunder as number) ?? 0) + (nextVote === -1 ? 1 : 0) - (prev === -1 ? 1 : 0),
    };
  });
}

// Absolute tally from the public realtime echo (proposal_vote_changed) — overwrite score/pro/kunder,
// never my_vote (the echo deliberately never says who voted).
export function applyProposalTallyToCaches(
  qc: QueryClient,
  proposalId: string,
  tally: { score: number; pro: number; kunder: number },
) {
  patchAll(qc, proposalId, (p) => {
    if (p.score === tally.score && p.pro === tally.pro && p.kunder === tally.kunder) return null;
    return { ...p, score: tally.score, pro: tally.pro, kunder: tally.kunder };
  });
}

// The caller's own vote from the private side-channel (my_proposal_vote_changed) — sync colour across the
// user's devices/tabs without moving the score (the public echo already moved it).
export function applyMyProposalVoteToCaches(qc: QueryClient, proposalId: string, value: number) {
  patchAll(qc, proposalId, (p) =>
    ((p.my_vote as number) ?? 0) === value ? null : { ...p, my_vote: value },
  );
}

function patchAll(
  qc: QueryClient,
  proposalId: string,
  update: (p: ProposalNode) => ProposalNode | null,
) {
  qc.setQueriesData({}, (data: unknown) => patchProposal(data, proposalId, update));
}

function patchProposal<T>(
  data: T,
  id: string,
  update: (p: ProposalNode) => ProposalNode | null,
): T {
  if (Array.isArray(data)) {
    let changed = false;
    const next = data.map((item) => {
      const patched = patchProposal(item, id, update);
      if (patched !== item) changed = true;
      return patched;
    });
    return (changed ? next : data) as T;
  }
  if (data && typeof data === "object") {
    const obj = data as ProposalNode;
    if (obj.id === id && "my_vote" in obj && "pro" in obj) {
      const updated = update(obj);
      return (updated ?? data) as T;
    }
    let changed = false;
    const next: ProposalNode = {};
    for (const key in obj) {
      const patched = patchProposal(obj[key], id, update);
      if (patched !== obj[key]) changed = true;
      next[key] = patched;
    }
    return (changed ? next : data) as T;
  }
  return data;
}
