import { useState } from "react";
import { Send } from "lucide-react";
import { sq } from "@/i18n/sq";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { postMessage } from "@/lib/sheshi";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";

interface Props {
  roomId: string;
  parentId?: string | null;
  currentUserId: string | null;
  onPosted?: () => void;
  placeholder?: string;
}

export function Composer({ roomId, parentId = null, currentUserId, onPosted, placeholder }: Props) {
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);

  if (!currentUserId) {
    return (
      <div className="border-t bg-card px-4 py-3 text-sm text-muted-foreground flex items-center justify-between">
        <span>{sq.chat.signInToPost}</span>
        <Button asChild size="sm"><Link to="/auth">{sq.auth.signIn}</Link></Button>
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
    } catch (e: any) {
      const msg = e?.message === "TOO_LONG" ? "Tepër i gjatë (>2000)" : sq.errors.generic;
      toast.error(msg);
    } finally {
      setPosting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="border-t bg-card px-3 py-3 sticky bottom-16 md:bottom-0">
      <div className="flex gap-2 items-end">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={placeholder || sq.chat.placeholder}
          rows={2}
          maxLength={2000}
          className="resize-none min-h-[44px]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSubmit(e);
          }}
        />
        <Button type="submit" disabled={posting || !body.trim()} size="icon" className="h-11 w-11 shrink-0">
          <Send className="h-4 w-4" />
        </Button>
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground text-right tabular-nums">
        {body.length}/2000
      </div>
    </form>
  );
}
