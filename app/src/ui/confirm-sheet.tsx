import type { RefObject } from "react";
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
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** A quiet link under ביטול to the path that loses nothing, such as moving the lines before a delete. */
  alternative?: { label: string; onClick: () => void };
};

export function ConfirmSheet({
  open,
  onOpenChange,
  title,
  item,
  consequence,
  detail,
  confirmLabel,
  destructive = false,
  busy = false,
  onConfirm,
  returnFocusRef,
  alternative,
}: ConfirmSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} returnFocusRef={returnFocusRef}>
      {item ? <p className="t-label text-text-secondary">{item}</p> : null}
      <p className="t-hint text-text-secondary">{consequence}</p>
      {detail ? <p className="t-hint text-text-secondary">{detail}</p> : null}
      <Button
        variant={destructive ? "danger-tint" : "primary"}
        full
        busy={busy}
        icon={destructive ? <TrashIcon /> : undefined}
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
        onClick={() => {
          onOpenChange(false);
        }}
      >
        ביטול
      </Button>
      {alternative ? (
        <div className="flex justify-center">
          <TextLink tone="quiet" chevron={false} wrap disabled={busy} onClick={alternative.onClick}>
            {alternative.label}
          </TextLink>
        </div>
      ) : null}
    </Sheet>
  );
}
