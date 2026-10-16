import type { ChoiceSheetCopy } from "./choice-sheet";
import type { ThemeChoice } from "../theme-store";

/** Settings › מראה: the device's appearance (FLOW-372). The board's words: לפי המכשיר is the default. */
export const THEME_CHOICES = [
  { value: "system", label: "לפי המכשיר", description: "עובר בין בהיר לכהה יחד עם הטלפון" },
  { value: "light", label: "בהיר", description: "רקע לבן, נוח באור יום" },
  { value: "dark", label: "כהה", description: "רקע כהה, נוח בערב ובחושך" },
] as const satisfies ReadonlyArray<{ value: ThemeChoice; label: string; description: string }>;

export const THEME_TITLE = "מראה";
export const THEME_SUBTITLE = "רק בטלפון הזה";

/** "לפי המכשיר", "בהיר" or "כהה": the row's value. */
export function themeChoiceLabel(choice: ThemeChoice): string {
  return THEME_CHOICES.find((option) => option.value === choice)?.label ?? THEME_CHOICES[0].label;
}

/** The theme sheet's words (FLOW-372): its history entry, title, subtitle and rows. */
export const THEME_COPY: ChoiceSheetCopy<ThemeChoice> = {
  historyKey: "theme",
  title: THEME_TITLE,
  subtitle: THEME_SUBTITLE,
  choices: THEME_CHOICES,
};
