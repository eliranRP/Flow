// FLOW-369: the add form's preview data. The preview route (?preview=) has no books, so the form
// reads this invented USD company instead. Nothing here is a real name.
import type { EntryDraft } from "./add-entry";

export const SAMPLE_CURRENCY = "USD";

export const SAMPLE_PROJECTS = [
  { id: "sp-1", name: "Lakeview Duplex" },
  { id: "sp-2", name: "Harbor Point" },
  { id: "sp-3", name: "Willow Creek" },
  { id: "sp-4", name: "Summit Row" },
  { id: "sp-5", name: "Birch Lane" },
];

export const SAMPLE_CATEGORIES = [
  { id: "sc-1", name: "חומרים", kind: "expense" as const },
  { id: "sc-2", name: "עבודה", kind: "expense" as const },
  { id: "sc-3", name: "ציוד", kind: "expense" as const },
  { id: "sc-4", name: "הובלה", kind: "expense" as const },
  { id: "sc-5", name: "אחר", kind: "expense" as const },
];

/**
 * FLOW-369: the preview's `?entry=` states. cash and cheque open the form with the board frame's values:
 * the amount, the date and the formats are the board's, the names are invented.
 */
export interface SampleEntryFill {
  draft: Partial<EntryDraft>;
}

export const SAMPLE_ENTRY_FILLS: Record<string, SampleEntryFill> = {
  cash: { draft: { amount: "350.00", payee: "Dana R.", date: "11/10/2026", method: "cash", projectId: "sp-3", categoryId: "sc-2" } },
  cheque: { draft: { amount: "350.00", payee: "Dana R.", date: "11/10/2026", method: "cheque", projectId: "sp-3", categoryId: "sc-2" } },
};

/** FLOW-369: `?entry=project` opens the + sheet from this invented project (the board's from-project frame). */
export const SAMPLE_FROM_PROJECT = { id: "sp-5", name: "Birch Lane" };
