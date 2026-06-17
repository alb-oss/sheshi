import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Fake the two external boundaries: the network post and sonner's toast. The draft autosave logic
// (the thing under test) runs for real against the in-memory localStorage from the setup file.
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const postMessage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sheshi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sheshi")>();
  return { ...actual, postMessage };
});

import { Composer } from "@/components/Composer";

const DRAFT_KEY = "sheshi:draft:room-1:root";

beforeEach(() => {
  toast.error.mockClear();
  postMessage.mockReset();
  postMessage.mockResolvedValue({ id: "m1" });
});

function renderComposer(props: Partial<React.ComponentProps<typeof Composer>> = {}) {
  return render(<Composer roomId="room-1" currentUserId="user-1" {...props} />);
}

describe("Composer auth gating", () => {
  it("renders nothing for a logged-out reader", () => {
    const { container } = render(<Composer roomId="room-1" currentUserId={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Composer draft autosave (sheshi:draft: key)", () => {
  it("debounced-persists the typed body to localStorage under the room+root key", async () => {
    const user = userEvent.setup();
    renderComposer();

    const textarea = screen.getByRole("textbox");
    // Synchronous read right after typing: nothing yet — the autosave is debounced (~300ms).
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
    await user.type(textarea, "draft in progress");

    await waitFor(() => expect(window.localStorage.getItem(DRAFT_KEY)).toBe("draft in progress"));
  });

  it("restores an existing draft from localStorage on mount", () => {
    window.localStorage.setItem(DRAFT_KEY, "saved earlier");
    renderComposer();
    expect(screen.getByRole("textbox")).toHaveValue("saved earlier");
  });

  it("keys the draft per reply target (parentId)", async () => {
    const user = userEvent.setup();
    renderComposer({ parentId: "parent-9" });
    await user.type(screen.getByRole("textbox"), "a reply");
    await waitFor(() =>
      expect(window.localStorage.getItem("sheshi:draft:room-1:parent-9")).toBe("a reply"),
    );
    // The root draft is untouched.
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("clears the persisted draft when the body is emptied", async () => {
    window.localStorage.setItem(DRAFT_KEY, "to be cleared");
    const user = userEvent.setup();
    renderComposer();
    await user.clear(screen.getByRole("textbox"));
    await waitFor(() => expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull());
  });
});

describe("Composer send", () => {
  it("posts the message and clears the draft immediately on success", async () => {
    const user = userEvent.setup();
    const onPosted = vi.fn();
    renderComposer({ onPosted });

    await user.type(screen.getByRole("textbox"), "ship it");
    await waitFor(() => expect(window.localStorage.getItem(DRAFT_KEY)).toBe("ship it"));

    await user.click(screen.getByRole("button", { name: "Posto" }));

    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith({
        room_id: "room-1",
        body: "ship it",
        parent_id: null,
        image: null,
        video: null,
      }),
    );
    // The durable commit succeeded — the draft is discarded immediately (not after the 300ms debounce)
    // so a refresh can't restore an already-sent message, the textarea is emptied, and onPosted fires.
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(""));
    expect(onPosted).toHaveBeenCalledTimes(1);
  });

  it("does not clear the draft when the send fails", async () => {
    postMessage.mockRejectedValueOnce(new Error("network down"));
    const user = userEvent.setup();
    renderComposer();

    await user.type(screen.getByRole("textbox"), "keep me");
    await waitFor(() => expect(window.localStorage.getItem(DRAFT_KEY)).toBe("keep me"));

    await user.click(screen.getByRole("button", { name: "Posto" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    // Failed commit → the draft survives so the user doesn't lose their text.
    expect(window.localStorage.getItem(DRAFT_KEY)).toBe("keep me");
    expect(screen.getByRole("textbox")).toHaveValue("keep me");
  });

  it("keeps the send button disabled until there is content", async () => {
    const user = userEvent.setup();
    renderComposer();
    const send = screen.getByRole("button", { name: "Posto" });
    expect(send).toBeDisabled();
    await user.type(screen.getByRole("textbox"), "x");
    expect(send).toBeEnabled();
  });
});
