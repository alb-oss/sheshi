import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { sq } from "@/i18n/sq";
import { SheshiError, submitReport, type ReportReason } from "@/lib/sheshi";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  messageId: string;
}

const reasons: ReportReason[] = ["spam", "hate", "doxxing", "violence", "other"];

export function ReportDialog({ open, onOpenChange, messageId }: Props) {
  const [reason, setReason] = useState<ReportReason>("spam");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    setSubmitting(true);
    try {
      await submitReport({ message_id: messageId, reason, note: note.slice(0, 500) });
      toast.success(sq.report.submitted);
      onOpenChange(false);
      setNote("");
      setReason("spam");
    } catch (error) {
      toast.error(
        error instanceof SheshiError && error.code === "UNAUTH"
          ? sq.errors.auth
          : error instanceof SheshiError && error.code === "RATE_LIMITED"
            ? sq.errors.rateLimited
          : sq.errors.generic,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{sq.report.title}</DialogTitle>
          <DialogDescription>{sq.report.description}</DialogDescription>
        </DialogHeader>
        <RadioGroup
          value={reason}
          onValueChange={(v) => setReason(v as ReportReason)}
          className="space-y-2"
        >
          {reasons.map((r) => (
            <div key={r} className="flex items-center gap-2">
              <RadioGroupItem value={r} id={`reason-${r}`} />
              <Label htmlFor={`reason-${r}`}>{sq.report.reasons[r]}</Label>
            </div>
          ))}
        </RadioGroup>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={sq.report.note}
          maxLength={500}
          rows={3}
        />
        <DialogFooter>
          <Button onClick={onSubmit} disabled={submitting}>
            {sq.report.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
