import { Copy, Link2, Mail, MessageCircle, Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { sq } from "@/i18n/sq";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// Restored from the pre-rewrite app: a share sheet for a thread. The caller (MessageCard)
// prefers the native `navigator.share` sheet on mobile and only falls back to this dialog
// when the platform has no native share — so this is the desktop / unsupported path.
export interface ShareTarget {
  title: string;
  text: string;
  url: string;
  roomLabel?: string | null;
}

const ICON_CLASS = "h-[18px] w-[18px]";

// lucide dropped brand glyphs, so the X and Facebook marks are inline SVGs (currentColor so they
// inherit the tile's hover/active color like the lucide icons do).
function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  );
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073Z" />
    </svg>
  );
}

export function ShareDialog({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  target: ShareTarget;
}) {
  const encodedUrl = encodeURIComponent(target.url);
  const encodedText = encodeURIComponent(target.text);
  const fullText = encodeURIComponent(`${target.text}\n${target.url}`);

  const options: { label: string; icon: React.ReactNode; href: string }[] = [
    { label: "WhatsApp", icon: <MessageCircle className={ICON_CLASS} />, href: `https://wa.me/?text=${fullText}` },
    { label: "Telegram", icon: <Send className={ICON_CLASS} />, href: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}` },
    { label: "X", icon: <XIcon className={ICON_CLASS} />, href: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}` },
    { label: "Facebook", icon: <FacebookIcon className={ICON_CLASS} />, href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}` },
    { label: "Email", icon: <Mail className={ICON_CLASS} />, href: `mailto:?subject=${encodeURIComponent(target.title)}&body=${fullText}` },
  ];

  const optionClass =
    "flex flex-col items-center justify-center gap-1.5 rounded-sm border border-border bg-card px-2 py-3 text-[10px] font-bold uppercase tracking-widest text-foreground/70 transition-colors hover:border-primary/60 hover:bg-primary/5 hover:text-primary";

  async function onCopy() {
    const ok = await copyText(target.url);
    if (ok) {
      toast.success(sq.share.copied);
      onOpenChange(false);
    } else {
      toast.error(sq.share.copyFailed);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{sq.share.title}</DialogTitle>
          <DialogDescription>{sq.share.via}</DialogDescription>
        </DialogHeader>

        <div className="rounded-sm border border-border bg-card/60 px-3 py-2.5">
          <div className="text-[9px] font-bold uppercase tracking-widest text-primary">
            {target.roomLabel || sq.appName}
          </div>
          <div className="mt-1 line-clamp-2 text-sm text-foreground/90">
            {target.text || target.title}
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-foreground/40">
            <Link2 className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{target.url}</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {options.map((option) => (
            <a
              key={option.label}
              href={option.href}
              target="_blank"
              rel="noreferrer"
              onClick={() => onOpenChange(false)}
              className={optionClass}
            >
              {option.icon}
              {option.label}
            </a>
          ))}
          <button type="button" onClick={() => void onCopy()} className={cn(optionClass)}>
            <Copy className={ICON_CLASS} />
            {sq.share.copy}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
