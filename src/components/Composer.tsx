import { useState } from "react";
import { sq } from "@/i18n/sq";
import { postMessage } from "@/lib/sheshi";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

interface Props {
  roomId: string;
  parentId?: string | null;
  currentUserId: string | null;
  onPosted?: () => void;
  placeholder?: string;
}

export function Composer({
  roomId,
  parentId = null,
  currentUserId,
  onPosted,
  placeholder,
}: Props) {
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);

  if (!currentUserId) {
    return (
      <div className="border-t border-border bg-background px-4 py-4 flex items-center justify-between gap-3">
        <span className="text-sm text-foreground/50">{sq.chat.signInToPost}</span>
        <Link
          to="/auth"
          className="px-4 py-1.5 bg-primary text-primary-foreground text-xs font-bold uppercase tracking-widest hover:bg-primary/85 transition-colors rounded-sm"
        >
          {sq.auth.signIn}
        </Link>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() || posting) return;
    setPosting(true);
    try {
      await postMessage({ room_id: roomId, body, parent_id: parentId });
      setBody("");
      onPosted?.();
    } catch (err: unknown) {
      const msg =
        err instanceof Error && err.message === "TOO_LONG"
          ? "Tepër i gjatë (>2000)"
          : sq.errors.generic;
      toast.error(msg);
    } finally {
      setPosting(false);
    }
  }

  const over = body.length > 1800;

  return (
    <form
      onSubmit={onSubmit}
      className="border-t border-border bg-background px-4 py-4"
    >
      <div className="bg-card rounded-sm border border-border p-1 flex items-end gap-2 focus-within:border-primary/40 transition-colors">
        <textarea
          rows={1}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={placeholder || `${sq.chat.placeholder}`}
          maxLength={2000}
          className="flex-1 bg-transparent border-none outline-none text-sm py-2 px-3 resize-none text-foreground placeholder:text-foreground/30 min-h-[40px] max-h-40"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSubmit(e);
          }}
        />
        <button
          type="submit"
          disabled={posting || !body.trim()}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-widest hover:bg-primary/85 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
        >
          {sq.chat.send}
        </button>
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-foreground/30 px-1">
        <span className="uppercase tracking-widest font-bold">⌘ + Enter</span>
        <span className={cn("tabular-nums font-bold", over && "text-primary")}>
          {body.length}/2000
        </span>
      </div>
    </form>
  );
}
