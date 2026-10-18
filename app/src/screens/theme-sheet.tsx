import type { RefObject } from "react";
import type { ThemeChoice } from "../theme-store";
import { ChoiceSheet } from "../ui/choice-sheet";
import { THEME_COPY, themeChoiceLabel } from "../ui/theme-choices";
import { useToast } from "../ui/toast";

/** The undo toast stays for 3 s (the board's), not the default action toast's 5 s. */
export const THEME_UNDO_MS = 3000;

/**
 * The toast after a pick, from the board: "המראה עובר עם הטלפון" for the device's choice, else
 * "מראה" and the choice's name ("מראה בהיר", "מראה כהה").
 */
export function themePickToast(choice: ThemeChoice): string {
  return choice === "system" ? "המראה עובר עם הטלפון" : `מראה ${themeChoiceLabel(choice)}`;
}

/**
 * Settings › מראה (FLOW-372). A tap applies the choice at once, closes the sheet and shows the
 * undo toast; ביטול only reverts to the previous choice (no second toast, as on the board).
 * The choice is saved per device by `onChange`.
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
      panelClassName="ui-sheet-g12 ui-theme-sheet"
      onPick={(next, close) => {
        const previous = value;
        onChange(next);
        close();
        toast.show({
          message: themePickToast(next),
          action: "ביטול",
          durationMs: THEME_UNDO_MS,
          onAction: () => {
            onChange(previous);
          },
        });
      }}
    />
  );
}
