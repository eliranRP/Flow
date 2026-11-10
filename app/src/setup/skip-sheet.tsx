import { useState } from "react";
import { Button } from "../ui/button";
import { Sheet } from "../ui/sheet";
import { SAVE_ERROR, SKIP_SHEET_BODY, SKIP_SHEET_CONFIRM, SKIP_SHEET_STAY, SKIP_SHEET_TITLE } from "./copy";

/**
 * "לדלג על ההגדרה?" (FLOW-514 §1). Confirm skips every step not done and goes to Home; the link
 * closes it. Back closes it too (the shared Sheet keeps the history step). A confirm that fails
 * (FLOW-1161) puts SAVE_ERROR in the body's place and keeps the sheet open.
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
  const [failed, setFailed] = useState(false);
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) setFailed(false); onOpenChange(next); }} title={SKIP_SHEET_TITLE} busy={busy} closeButton={false} panelClassName="ui-skip-sheet">
      <p className="t-line2 ui-skip-body" role={failed ? "alert" : undefined}>{failed ? SAVE_ERROR : SKIP_SHEET_BODY}</p>
      <Button
        type="button"
        full
        busy={busy}
        onClick={() => {
          setBusy(true);
          setFailed(false);
          void Promise.resolve(onConfirm())
            .catch(() => { setFailed(true); })
            .finally(() => { setBusy(false); });
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
