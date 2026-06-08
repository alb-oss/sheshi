import { useEffect, useRef, useState } from "react";
import { SendHorizontal } from "lucide-react";
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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Autosize
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, 200);
    el.style.height = next + "px";
  }, [body]);

  if (!currentUserId) {
    return (
      <div className="border-t border-border bg-background px-4 py-4 flex items-center justify-between gap-3">
        <span className="text-sm text-foreground/60">{sq.chat.signInToPost}</span>
        <Link
          to="/auth"
          className="px-4 py-2 bg-primary text-primary-foreground text-xs font-bold uppercase tracking-widest hover:bg-primary/85 transition-colors rounded-sm"
        >
          {sq.auth.signIn}
        </Link>
      </div>
    );
  }

  async function doSubmit() {
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

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    void doSubmit();
  }

  const over = body.length > 1800;
  const canSend = !!body.trim() && !posting;

  return (
    <form
      onSubmit={onSubmit}
      className="border-t border-border bg-background px-3 sm:px-4 py-3"
    >
      <div className="bg-card border border-border rounded-sm focus-within:border-primary/60 transition-colors">
        <textarea
          ref={textareaRef}
          rows={1}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={placeholder || sq.chat.placeholder}
          maxLength={2000}
          className="block w-full bg-transparent border-none outline-none text-[15px] leading-relaxed py-3 px-3.5 resize-none text-foreground placeholder:text-foreground/40 min-h-[48px] max-h-[200px]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void doSubmit();
            }
          }}
        />
        <div className="flex items-center justify-between gap-3 px-2.5 pb-2 pt-1">
          <span className="text-[10px] uppercase tracking-widest font-bold text-foreground/30">
            Enter për të postuar · Shift+Enter rresht i ri
          </span>
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "text-[10px] tabular-nums font-bold",
                over ? "text-primary" : "text-foreground/30",
              )}
            >
              {body.length}/2000
            </span>
            <button
              type="submit"
              disabled={!canSend}
              aria-label={sq.chat.send}
              className={cn(
                "inline-flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 rounded-sm text-xs font-bold uppercase tracking-widest transition-colors shrink-0",
                canSend ? "hover:bg-primary/85" : "opacity-40 cursor-not-allowed",
              )}
            >
              <span>{sq.chat.send}</span>
              <SendHorizontal className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
