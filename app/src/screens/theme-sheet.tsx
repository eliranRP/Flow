import type { RefObject } from "react";
import type { ThemeChoice } from "../theme-store";
import { ChoiceSheet } from "../ui/choice-sheet";
import { THEME_COPY } from "../ui/theme-choices";
import { useToast } from "../ui/toast";

export const THEME_SAVED = "המראה נשמר";
export const THEME_UNDONE = "המראה הוחזר";
/** The undo toast stays for 3 s (the board's), not the default action toast's 5 s. */
export const THEME_UNDO_MS = 3000;

/**
 * Settings › מראה (FLOW-372). A tap applies the choice at once, closes the sheet and shows the
 * undo toast; ביטול restores the previous choice. The choice is saved per device by `onChange`.
 */
export function ThemeSheet({
  open,
  onOpenChange,
  value,
  onChange,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: ThemeChoice;
  /** Saves and applies the choice (the Settings screen owns the state). */
  onChange: (choice: ThemeChoice) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const toast = useToast();
  return (
    <ChoiceSheet
      copy={THEME_COPY}
      open={open}
      onOpenChange={onOpenChange}
      value={value}
      saving={null}
      returnFocusRef={returnFocusRef}
      onPick={(next, close) => {
        const previous = value;
        onChange(next);
        close();
        toast.show({
          message: THEME_SAVED,
          action: "ביטול",
          durationMs: THEME_UNDO_MS,
          onAction: () => {
            onChange(previous);
            toast.show({ message: THEME_UNDONE });
          },
        });
      }}
    />
  );
}
