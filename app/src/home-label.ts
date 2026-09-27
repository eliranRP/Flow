/** Band label. Empty first run has no number. A real month name appears once figures exist. */
export function profitBandLabel(hasFigures: boolean, now = new Date()): string {
  if (!hasFigures) return "כאן יופיע הרווח הנקי של העסק";
  const month = new Intl.DateTimeFormat("he-IL", { month: "long" }).format(now);
  return `רווח נקי ב${month}`;
}

export function homeGreeting(name: string | null | undefined): string {
  const trimmed = name?.trim();
  if (!trimmed) return "שלום, …";
  return `שלום, ${trimmed}`;
}
