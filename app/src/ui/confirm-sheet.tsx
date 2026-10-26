import type { ReactNode, RefObject } from "react";
import { Button } from "./button";
import { TrashIcon } from "./icons";
import { Sheet } from "./sheet";

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
  /** Opt-in classes for the panel (the project delete confirm's roomier board rhythm). */
  panelClassName?: string;
  /** A field above the confirm button (the danger zone's typed company name). */
  children?: ReactNode;
  /** Keeps the confirm button off until the field above says yes. */
  confirmDisabled?: boolean;
};

export function ConfirmSheet({
  open,
  onOpenChange,
  title,
  item,
  consequence,
  detail,
  consequenceSize = "hint",
  confirmLabel,
  destructive = false,
  icon,
  busy = false,
  onConfirm,
  returnFocusRef,
  alternative,
  closeButton = true,
  panelClassName,
  children,
  confirmDisabled = false,
}: ConfirmSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} returnFocusRef={returnFocusRef} busy={busy} closeButton={closeButton} panelClassName={panelClassName}>
      {item ? <p className="t-line2 text-text-secondary">{item}</p> : null}
      <p className={consequenceSize === "body" ? "ui-confirm-body" : "t-caption t-muted text-text-secondary"}>{consequence}</p>
      {detail ? <p className="t-caption t-muted text-text-secondary">{detail}</p> : null}
      {children}
      <Button
        variant={destructive === false ? "primary" : "secondary"}
        className={destructive === false ? undefined : "ui-btn-signal"}
        full
        busy={busy}
        disabled={confirmDisabled}
        icon={icon !== undefined ? icon ?? undefined : destructive === true ? <TrashIcon /> : undefined}
        onClick={() => {
          onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
      <Button
        variant="link"
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
          <Button variant="link" quiet disabled={busy} onClick={alternative.onClick} className="ui-btn-link-wrap">
            {alternative.label}
          </Button>
        </div>
      ) : null}
    </Sheet>
  );
}
