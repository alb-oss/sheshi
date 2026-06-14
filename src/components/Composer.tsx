import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { CornerDownRight, ImagePlus, SendHorizontal, X } from "lucide-react";
import { sq } from "@/i18n/sq";
import { postMessage, SheshiError } from "@/lib/sheshi";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const LEADING_REPLY_MENTIONS = /^(@[A-Za-z0-9._-]+\s*)+/;

interface Props {
  roomId: string;
  parentId?: string | null;
  currentUserId: string | null;
  onPosted?: () => void;
  placeholder?: string;
  replyContext?: { label: string; excerpt?: string } | null;
  onClearReplyContext?: () => void;
  // Inline (Reddit-style) reply: renders directly under a comment instead of docked at the
  // bottom. `compact` drops the docked top border and tightens the chrome; `autoFocus` grabs
  // the caret on mount (so the comment scrolls into view + the mobile keyboard opens);
  // `onCancel` adds an explicit dismiss button next to send.
  autoFocus?: boolean;
  compact?: boolean;
  onCancel?: () => void;
}

export interface ComposerHandle {
  focus: () => void;
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  {
    roomId,
    parentId = null,
    currentUserId,
    onPosted,
    placeholder,
    replyContext,
    onClearReplyContext,
    autoFocus,
    compact,
    onCancel,
  },
  ref,
) {
  const [body, setBody] = useState("");
  const [focused, setFocused] = useState(false);
  const [image, setImage] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
  }));

  // Autosize
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, 200);
    el.style.height = next + "px";
  }, [body]);

  useEffect(() => {
    if (!image) {
      setImagePreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(image);
    setImagePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  useEffect(() => {
    if (!replyContext) return;
    setBody((current) => stripLeadingReplyMentions(current));
  }, [replyContext?.label]);

  // Inline reply: take focus on mount so the targeted comment scrolls into view and the
  // mobile keyboard opens immediately (the whole point of the Reddit-style inline box).
  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  function clearImage() {
    setImage(null);
    if (imageInputRef.current) imageInputRef.current.value = "";
  }

  function selectImage(file: File | null) {
    if (!file) {
      clearImage();
      return;
    }
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      toast.error("Lejohen vetëm PNG, JPG ose WebP.");
      clearImage();
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error("Imazhi duhet të jetë nën 5 MB.");
      clearImage();
      return;
    }
    setImage(file);
  }

  if (!currentUserId) {
    return (
      <div className="border-t border-border bg-background px-4 py-4 flex items-center justify-between gap-3">
        <span className="text-sm text-foreground/60">{sq.chat.signInToPost}</span>
        <Link
          to="/auth"
          className="px-4 py-2 bg-primary text-primary-foreground text-xs font-bold uppercase tracking-widest hover:bg-primary/85 transition-colors rounded-full"
        >
          {sq.auth.signIn}
        </Link>
      </div>
    );
  }

  async function doSubmit() {
    const bodyToPost = replyContext ? stripLeadingReplyMentions(body) : body;
    if ((!bodyToPost.trim() && !image) || posting) return;
    setPosting(true);
    try {
      await postMessage({ room_id: roomId, body: bodyToPost, parent_id: parentId, image });
      setBody("");
      clearImage();
      onClearReplyContext?.();
      onPosted?.();
    } catch (err: unknown) {
      const msg =
        err instanceof SheshiError && err.code === "TOO_LONG"
          ? "Tepër i gjatë (>2000)"
          : err instanceof SheshiError && err.code === "UNAUTH"
            ? sq.errors.auth
          : err instanceof SheshiError && err.code === "RATE_LIMITED"
            ? sq.errors.rateLimited
          : err instanceof SheshiError && err.code === "INVALID_IMAGE"
            ? sq.errors.imageInvalid
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
  const canSend = (!!body.trim() || !!image) && !posting;
  // Reddit-style mobile "join conversation" bar: until the box is focused or has content it's a
  // slim one-line prompt — the toolbar (image · counter · send) only appears once you engage.
  // Always expanded on desktop and for the inline reply composer.
  const expanded = compact || focused || !!body.trim() || !!image || !!replyContext;

  return (
    <form
      onSubmit={onSubmit}
      className={cn(
        compact
          ? "pb-3 pt-1"
          : "border-t border-border bg-background px-2 py-2 sm:px-4 sm:py-3",
      )}
    >
      <div
        className={cn(
          "bg-card border border-border rounded-2xl transition-colors focus-within:border-foreground/25",
          compact && "border-primary/30",
        )}
      >
        {replyContext && (
          <div className="flex items-start justify-between gap-2 border-b border-border bg-primary/5 px-3 py-2 sm:items-center sm:gap-3 sm:px-3.5">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 truncate font-bold uppercase tracking-widest text-primary">
                Përgjigje për {replyContext.label}
              </span>
              {replyContext.excerpt ? (
                <span className="truncate text-foreground/45">— {replyContext.excerpt}</span>
              ) : null}
            </div>
            {onClearReplyContext ? (
              <button
                type="button"
                onClick={onClearReplyContext}
                aria-label="Anulo përgjigjen"
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-foreground/45 transition-colors hover:bg-background hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        )}
        {image && (
          <div className="flex items-center justify-between gap-3 border-b border-border bg-background/60 px-3 py-2 sm:px-3.5">
            <div className="flex min-w-0 items-center gap-3">
              {imagePreviewUrl ? (
                <img
                  src={imagePreviewUrl}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded-sm border border-border object-cover"
                />
              ) : null}
              <div className="min-w-0">
                <div className="truncate text-xs font-bold uppercase tracking-widest text-foreground/60">
                  {image.name}
                </div>
                <div className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-foreground/35">
                  {(image.size / 1024 / 1024).toFixed(1)} MB
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={clearImage}
              aria-label="Hiq imazhin"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-foreground/45 transition-colors hover:bg-card hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <textarea
          ref={textareaRef}
          rows={1}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={placeholder || sq.chat.placeholder}
          maxLength={2000}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="block w-full bg-transparent border-none outline-none text-base leading-relaxed py-2.5 px-3 resize-none text-foreground placeholder:text-foreground/40 min-h-[44px] max-h-[200px] overflow-y-auto no-scrollbar sm:px-3.5 sm:py-3 sm:text-[15px] sm:min-h-[48px]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void doSubmit();
            }
          }}
        />
        <div className={cn("items-center justify-between gap-2 px-2.5 pb-2 pt-1", expanded ? "flex" : "hidden sm:flex")}>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => selectImage(event.target.files?.[0] ?? null)}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              aria-label="Shto imazh"
              className="inline-flex h-9 w-9 items-center justify-center rounded-sm text-foreground/40 transition-colors hover:bg-background hover:text-primary"
            >
              <ImagePlus className="h-4 w-4" />
            </button>
            <span
              className={cn(
                "text-[10px] tabular-nums font-bold",
                over ? "text-primary" : "text-foreground/30",
              )}
            >
              {body.length}/2000
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {onCancel ? (
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex h-9 items-center rounded-sm px-2.5 text-xs font-bold uppercase tracking-widest text-foreground/45 transition-colors hover:bg-background hover:text-foreground"
              >
                {sq.chat.cancel}
              </button>
            ) : null}
            <button
              type="submit"
              disabled={!canSend}
              aria-label={sq.chat.send}
              className={cn(
                "inline-flex h-9 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-full px-4 text-xs font-bold uppercase tracking-widest transition-colors sm:px-4",
                canSend
                  ? "bg-primary text-primary-foreground hover:bg-primary/85"
                  : "bg-secondary text-foreground/35 cursor-not-allowed",
              )}
            >
              <span className="hidden sm:inline">{sq.chat.send}</span>
              <SendHorizontal className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </form>
  );
});

function stripLeadingReplyMentions(value: string) {
  return value.replace(LEADING_REPLY_MENTIONS, "");
}
