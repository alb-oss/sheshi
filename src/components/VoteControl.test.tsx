import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { MessageRow } from "@/lib/sheshi";

// sonner's toast is a side-effecting external boundary; fake it so we can assert the sign-in nudge
// and that no vote request is attempted for a logged-out reader. Everything else (the QueryClient,
// the cache patching in VoteControl) runs for real.
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

// setVote is the network write; fake it so clicks don't hit fetch. We assert it is/ isn't called and
// with what value, which is the contract VoteControl owes the server.
const setVote = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/sheshi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sheshi")>();
  return { ...actual, setVote };
});

import { VoteControl } from "@/components/VoteControl";

function makeMessage(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: "m1",
    room_id: "r1",
    author_id: "a1",
    parent_id: null,
    body: "hello",
    image_url: null,
    video_url: null,
    deleted_at: null,
    created_at: "2026-01-01T00:00:00Z",
    score: 5,
    reply_count: 0,
    my_vote: 0,
    ...overrides,
  };
}

let queryClient: QueryClient;

beforeEach(() => {
  toast.error.mockClear();
  setVote.mockClear();
  setVote.mockResolvedValue(undefined);
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});

afterEach(() => {
  queryClient.clear();
});

function renderStatic(message: MessageRow, currentUserId: string | null) {
  return render(
    <QueryClientProvider client={queryClient}>
      <VoteControl message={message} currentUserId={currentUserId} />
    </QueryClientProvider>,
  );
}

// VoteControl treats the React Query cache as the single source of truth — clicking patches the
// cache rather than local state. To observe the toggle (colour/score), render the control with a
// message that LIVES in a query, so the cache patch re-renders the control through useQuery.
function CacheBoundVote({ currentUserId }: { currentUserId: string | null }) {
  // staleTime: Infinity so the query serves whatever the cache holds (pre-seeded per test) and never
  // refetches over the optimistic patch VoteControl writes.
  const { data } = useQuery<MessageRow>({
    queryKey: ["message", "m1"],
    queryFn: () => makeMessage(),
    staleTime: Infinity,
  });
  if (!data) return null;
  return <VoteControl message={data} currentUserId={currentUserId} />;
}

describe("VoteControl rendering", () => {
  it("renders the score and both vote arrows from the message prop", () => {
    renderStatic(makeMessage({ score: 5 }), "user-1");
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mbështet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kundërshto" })).toBeInTheDocument();
  });

  it("formats large scores in thousands", () => {
    renderStatic(makeMessage({ score: 1500 }), "user-1");
    expect(screen.getByText("1.5k")).toBeInTheDocument();
  });

  it("reflects an existing upvote via aria-pressed and the upvote colour", () => {
    renderStatic(makeMessage({ my_vote: 1 }), "user-1");
    const up = screen.getByRole("button", { name: "Mbështet" });
    expect(up).toHaveAttribute("aria-pressed", "true");
    expect(up.className).toContain("text-upvote");
  });

  it("reflects an existing downvote via aria-pressed", () => {
    renderStatic(makeMessage({ my_vote: -1 }), "user-1");
    expect(screen.getByRole("button", { name: "Kundërshto" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("VoteControl logged-out (no currentUserId)", () => {
  it("does nothing but show the sign-in nudge — no vote request", async () => {
    const user = userEvent.setup();
    renderStatic(makeMessage(), null);
    await user.click(screen.getByRole("button", { name: "Mbështet" }));
    expect(setVote).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Hyni për të postuar.");
    // aria-pressed stays false — nothing toggled.
    expect(screen.getByRole("button", { name: "Mbështet" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

describe("VoteControl toggling (cache is the source of truth)", () => {
  it("clicking up sets my_vote=1, bumps the score, recolours, and sends the vote", async () => {
    const user = userEvent.setup();
    queryClient.setQueryData<MessageRow>(["message", "m1"], makeMessage({ my_vote: 0, score: 5 }));
    render(
      <QueryClientProvider client={queryClient}>
        <CacheBoundVote currentUserId="user-1" />
      </QueryClientProvider>,
    );

    const up = screen.getByRole("button", { name: "Mbështet" });
    expect(up).toHaveAttribute("aria-pressed", "false");

    await user.click(up);

    await waitFor(() => expect(up).toHaveAttribute("aria-pressed", "true"));
    expect(up.className).toContain("text-upvote");
    // Optimistic delta: 5 → 6.
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(setVote).toHaveBeenCalledWith("m1", 1);
  });

  it("clicking the active vote again clears it (toggle off → value 0)", async () => {
    const user = userEvent.setup();
    queryClient.setQueryData<MessageRow>(["message", "m1"], makeMessage({ my_vote: 1, score: 6 }));
    render(
      <QueryClientProvider client={queryClient}>
        <CacheBoundVote currentUserId="user-1" />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Mbështet" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );

    await user.click(screen.getByRole("button", { name: "Mbështet" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Mbështet" })).toHaveAttribute(
        "aria-pressed",
        "false",
      ),
    );
    // Score rolls back 6 → 5.
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(setVote).toHaveBeenLastCalledWith("m1", 0);
  });
});
