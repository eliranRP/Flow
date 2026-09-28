import { Button } from "./button";
import { TrashIcon } from "./icons";
import { Sheet } from "./sheet";

type ConfirmSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  item?: string;
  consequence: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
};

export function ConfirmSheet({
  open,
  onOpenChange,
  title,
  item,
  consequence,
  confirmLabel,
  destructive = false,
  busy = false,
  onConfirm,
}: ConfirmSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title}>
      {item ? <p className="t-label text-text-secondary">{item}</p> : null}
      <p className="t-hint text-text-secondary">{consequence}</p>
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
    </Sheet>
  );
}
