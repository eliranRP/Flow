// FLOW-369: the add form's preview data. The preview route (?preview=) has no books, so the form
// reads this invented USD company instead. Nothing here is a real name.

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
