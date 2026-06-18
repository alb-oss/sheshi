import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { Proposal } from "@/lib/sheshi";

// sonner's toast is an external boundary; fake it to assert the sign-in / closed nudges without a portal.
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

// voteProposal is the network write; fake it so clicks don't hit fetch. We assert it is/isn't called and
// with which value — the contract the control owes the server.
const voteProposal = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/sheshi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sheshi")>();
  return { ...actual, voteProposal };
});

import { ProposalVoteControl } from "@/components/ProposalVoteControl";

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "p1",
    title: "Titull",
    body: "Trup",
    category: "ligje",
    status: "proposed",
    author_id: "a1",
    score: 0,
    pro: 2,
    kunder: 1,
    my_vote: 0,
    created_at: "2026-01-01T00:00:00Z",
    published_at: "2026-01-01T00:00:00Z",
    approved_at: null,
    ...overrides,
  };
}

let queryClient: QueryClient;

beforeEach(() => {
  toast.error.mockClear();
  voteProposal.mockClear();
  voteProposal.mockResolvedValue(undefined);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => queryClient.clear());

function renderStatic(proposal: Proposal, currentUserId: string | null) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ProposalVoteControl proposal={proposal} currentUserId={currentUserId} />
    </QueryClientProvider>,
  );
}

// Cache is the single source of truth — render the control bound to a query so the optimistic patch
// re-renders it (mirrors how the real list pages render proposals from a cached query).
function CacheBound({ currentUserId }: { currentUserId: string | null }) {
  const { data } = useQuery<Proposal>({
    queryKey: ["proposals", "p1"],
    queryFn: () => makeProposal(),
    staleTime: Infinity,
  });
  if (!data) return null;
  return <ProposalVoteControl proposal={data} currentUserId={currentUserId} />;
}

describe("ProposalVoteControl rendering", () => {
  it("shows the PRO and KUNDËR counts from the proposal prop", () => {
    renderStatic(makeProposal({ pro: 2, kunder: 1 }), "user-1");
    expect(screen.getByRole("button", { name: "Pro" })).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "Kundër" })).toHaveTextContent("1");
  });

  it("reflects an existing PRO vote via aria-pressed and the upvote colour", () => {
    renderStatic(makeProposal({ my_vote: 1 }), "user-1");
    const pro = screen.getByRole("button", { name: "Pro" });
    expect(pro).toHaveAttribute("aria-pressed", "true");
    expect(pro.className).toContain("text-upvote");
  });

  it("disables voting once the proposal is approved", () => {
    renderStatic(makeProposal({ status: "approved" }), "user-1");
    expect(screen.getByRole("button", { name: "Pro" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Kundër" })).toBeDisabled();
  });
});

describe("ProposalVoteControl logged-out", () => {
  it("nudges to sign in and sends no vote", async () => {
    const user = userEvent.setup();
    renderStatic(makeProposal(), null);
    await user.click(screen.getByRole("button", { name: "Pro" }));
    expect(voteProposal).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Hyni për të votuar.");
  });
});

describe("ProposalVoteControl toggling (cache is the source of truth)", () => {
  it("clicking PRO sets my_vote=1, bumps the PRO count, and sends value 1", async () => {
    const user = userEvent.setup();
    queryClient.setQueryData<Proposal>(["proposals", "p1"], makeProposal({ my_vote: 0, pro: 2 }));
    render(
      <QueryClientProvider client={queryClient}>
        <CacheBound currentUserId="user-1" />
      </QueryClientProvider>,
    );

    const pro = screen.getByRole("button", { name: "Pro" });
    expect(pro).toHaveAttribute("aria-pressed", "false");

    await user.click(pro);

    await waitFor(() => expect(pro).toHaveAttribute("aria-pressed", "true"));
    expect(pro).toHaveTextContent("3"); // optimistic 2 → 3
    expect(voteProposal).toHaveBeenCalledWith("p1", 1);
  });

  it("rolls the optimistic vote back when the request fails", async () => {
    const user = userEvent.setup();
    voteProposal.mockRejectedValueOnce(new Error("boom"));
    queryClient.setQueryData<Proposal>(["proposals", "p1"], makeProposal({ my_vote: 0, pro: 2 }));
    render(
      <QueryClientProvider client={queryClient}>
        <CacheBound currentUserId="user-1" />
      </QueryClientProvider>,
    );

    const pro = screen.getByRole("button", { name: "Pro" });
    await user.click(pro);

    // After the failed write the optimistic +1 is reverted: back to not-pressed and count 2.
    await waitFor(() => expect(pro).toHaveAttribute("aria-pressed", "false"));
    expect(pro).toHaveTextContent("2");
    expect(toast.error).toHaveBeenCalled();
  });
});
