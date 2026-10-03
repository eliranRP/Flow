import type { ReviewRow } from "@flow/shared";

/**
 * In-memory review queue for Playwright. Imported only from a
 * `import.meta.env.DEV` branch so the production bundle drops this module.
 * The hosted check rejects the supplier names and the string e2e=list.
 */
let e2eOpen: ReviewRow[] | null = null;
let e2eGone: ReviewRow[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function seed(): ReviewRow[] {
  const names = [
    ["r1", "מחסן הנמל"],
    ["r2", "עגורני החוף"],
    ["r3", "ברזל הדרום"],
    ["r4", "צבע הדרום"],
    ["r5", "חשמל הצפון"],
  ] as const;
  return names.map(([id, supplier]) => ({
    id,
    transaction_id: `t-${id}`,
    description: supplier,
    doc_date: "2026-09-29",
    amount_net: -10_000n,
    direction: "expense" as const,
    reason: null,
    project_id: "p1",
    category_id: "c1",
    project_name: "הרצל",
    category_name: "חומרים",
    project_suggested: false,
    category_suggested: false,
    supplier_name: supplier,
    doc_kind: "invoice",
    auto_approved_today: 0,
  }));
}

function ensure(): ReviewRow[] {
  if (e2eOpen == null) e2eOpen = seed();
  return e2eOpen;
}

export function currentRows(): ReviewRow[] {
  return ensure();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function dismissE2eReview(id: string): void {
  const open = ensure();
  const row = open.find((item) => item.id === id);
  if (!row) return;
  e2eGone = [row, ...e2eGone];
  e2eOpen = open.filter((item) => item.id !== id);
  notify();
}

export function restoreE2eReview(id: string): void {
  const row = e2eGone.find((item) => item.id === id);
  if (!row) return;
  e2eGone = e2eGone.filter((item) => item.id !== id);
  const ids = new Set(ensure().map((item) => item.id));
  ids.add(row.id);
  e2eOpen = seed().filter((item) => ids.has(item.id));
  notify();
}

export const e2eChangeSample = {
  supplier: "מחסן הנמל",
  amount: "₪100",
  projectId: "p1",
  categoryId: "c1",
  suggestionId: "p1",
  suggestionCategoryId: "c1",
  project_suggested: false,
  categorySuggested: false,
  projects: [{ id: "p1", name: "הרצל", status: "active" as const }],
  categories: [
    { id: "c1", name: "חומרים", hidden: false, kind: "expense" },
    { id: "c2", name: "הובלה", hidden: false, kind: "expense" },
  ],
};

export function e2ePreviewWrite(): {
  run: () => Promise<void>;
  onDone: (id: string) => void;
  onUndo: (id: string) => void;
} {
  return {
    run: () => Promise.resolve(),
    onDone: dismissE2eReview,
    onUndo: restoreE2eReview,
  };
}
