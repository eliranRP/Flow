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
  onConfirm,
}: ConfirmSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title}>
      {item ? <p className="t-label text-text-secondary">{item}</p> : null}
      <p className="t-hint text-text-secondary">{consequence}</p>
      <Button
        variant={destructive ? "danger" : "primary"}
        full
        onClick={() => {
          onConfirm();
        }}
      >
        {destructive ? <TrashIcon /> : null}
        {confirmLabel}
      </Button>
      <Button
        variant="ghost"
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
