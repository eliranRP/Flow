import { useState } from "react";
import { Button } from "../ui/button";
import { Sheet } from "../ui/sheet";
import { SKIP_SHEET_BODY, SKIP_SHEET_CONFIRM, SKIP_SHEET_STAY, SKIP_SHEET_TITLE } from "./copy";

/**
 * "לדלג על ההגדרה?" (FLOW-514 §1). Confirm skips every step not done and goes to Home; the link
 * closes it. Back closes it too (the shared Sheet keeps the history step).
 */
export function SkipSheet({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={SKIP_SHEET_TITLE} busy={busy}>
      <p className="t-label ui-skip-body">{SKIP_SHEET_BODY}</p>
      <Button
        type="button"
        full
        busy={busy}
        onClick={() => {
          setBusy(true);
          void Promise.resolve(onConfirm()).finally(() => { setBusy(false); });
        }}
      >
        {SKIP_SHEET_CONFIRM}
      </Button>
      <Button type="button" variant="link" full onClick={() => { onOpenChange(false); }}>
        {SKIP_SHEET_STAY}
      </Button>
    </Sheet>
  );
}
