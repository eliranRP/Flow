import type { ReactNode } from "react";
import { Button } from "./button";
import { Sheet } from "./sheet";

export type PeriodOption = {
  label: string;
  hint?: string;
  onSelect: () => void;
};

type PeriodPickerProps = {
  pill: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: PeriodOption[];
  footer?: ReactNode;
};

export function PeriodPicker({ pill, open, onOpenChange, options, footer }: PeriodPickerProps) {
  return (
    <>
      <button
        type="button"
        className="band-period ui-hit"
        onClick={() => {
          onOpenChange(true);
        }}
      >
        {pill}
        <span aria-hidden="true"> ▾</span>
      </button>
      <Sheet open={open} onOpenChange={onOpenChange} title="תקופה" modal={false}>
        <div className="choice-col">
          {options.map((option) => (
            <Button
              key={option.label}
              variant="secondary"
              full
              onClick={() => {
                option.onSelect();
                onOpenChange(false);
              }}
            >
              {option.label}
              {option.hint ? <span className="t-hint">{option.hint}</span> : null}
            </Button>
          ))}
        </div>
        {footer}
      </Sheet>
    </>
  );
}
