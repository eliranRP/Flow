import type { ReactNode, RefObject } from "react";
import { Button } from "./button";
import { TrashIcon } from "./icons";
import { Sheet } from "./sheet";
import { TextLink } from "./text-link";

type ConfirmSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  item?: string;
  consequence: string;
  /** A second hint line, for a consequence with a side effect (FLOW-405: split lines lose their split). */
  detail?: string;
  /** body (17/1.5) for a confirm that explains what stays and what goes (FLOW-445). Default hint. */
  consequenceSize?: "hint" | "body";
  /** A warning line in the signal-soft colour, under the consequence (FLOW-445: pending lines before a finish). */
  warning?: string;
  confirmLabel: string;
  /** true: the red tint with a bin. "outline": the signal outline with no bin (FLOW-445 delete). */
  destructive?: boolean | "outline";
  /** The confirm button's icon. A destructive confirm shows the bin unless this says otherwise; null shows none (FLOW-341: a merge is not a delete). */
  icon?: ReactNode;
  busy?: boolean;
  onConfirm: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** A quiet link under ביטול to the path that loses nothing, such as moving the lines before a delete. */
  alternative?: { label: string; onClick: () => void };
  /** false where the board draws no ✕ (swipe, the scrim and Escape still close). */
  closeButton?: boolean;
  /** Opt-in classes for the panel (the project finish confirm's roomier board rhythm). */
  panelClassName?: string;
};

export function ConfirmSheet({
  open,
  onOpenChange,
  title,
  item,
  consequence,
  detail,
  consequenceSize = "hint",
  warning,
  confirmLabel,
  destructive = false,
  icon,
  busy = false,
  onConfirm,
  returnFocusRef,
  alternative,
  closeButton = true,
  panelClassName,
}: ConfirmSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} returnFocusRef={returnFocusRef} busy={busy} closeButton={closeButton} panelClassName={panelClassName}>
      {item ? <p className="t-label text-text-secondary">{item}</p> : null}
      <p className={consequenceSize === "body" ? "ui-confirm-body" : "t-hint text-text-secondary"}>{consequence}</p>
      {warning ? <p className="ui-confirm-warning">{warning}</p> : null}
      {detail ? <p className="t-hint text-text-secondary">{detail}</p> : null}
      <Button
        variant={destructive === "outline" ? "danger-outline" : destructive ? "danger-tint" : "primary"}
        full
        busy={busy}
        icon={icon !== undefined ? icon ?? undefined : destructive === true ? <TrashIcon /> : undefined}
        onClick={() => {
          onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
      <Button
        variant="ghost"
        quiet
        full
        disabled={busy}
        onClick={() => {
          onOpenChange(false);
        }}
      >
        ביטול
      </Button>
      {alternative ? (
        <div className="ui-confirm-alt flex justify-center">
          <TextLink tone="quiet" chevron={false} wrap disabled={busy} onClick={alternative.onClick}>
            {alternative.label}
          </TextLink>
        </div>
      ) : null}
    </Sheet>
  );
}
