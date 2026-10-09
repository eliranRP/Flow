import type { ReviewRow } from "@flow/shared";
import type { JevQueueData } from "../screens/jev-review";

/**
 * In-memory review queue for Playwright. Imported only from a
 * `import.meta.env.DEV` branch so the production bundle drops this module.
 * The hosted check rejects the supplier names and the string e2e=list.
 */
let e2eOpen: ReviewRow[] | null = null;
let e2eGone: ReviewRow[] = [];
/** FLOW-309: `&rows=N` seeds N cards (5 by default), so the counter can step 9→10 or the queue can empty. */
let seedSize = 5;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function seed(): ReviewRow[] {
  const names: Array<readonly [string, string]> = [
    ["r1", "מחסן הנמל"],
    ["r2", "עגורני החוף"],
    ["r3", "ברזל לדוגמה"],
    ["r4", "צבע לדוגמה"],
    ["r5", "חשמלאות לדוגמה"],
  ];
  for (let n = names.length + 1; n <= seedSize; n += 1) names.push([`r${String(n)}`, `ספק בדיקה ${String(n)}`]);
  return names.slice(0, seedSize).map(([id, supplier]) => ({
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

/** `size` is the page's request; without one, the queue already seeded stands (dismiss, restore). */
function ensure(size?: number): ReviewRow[] {
  if (e2eOpen == null || (size != null && size !== seedSize)) {
    seedSize = size ?? 5;
    e2eGone = [];
    e2eOpen = seed();
  }
  return e2eOpen;
}

/** The size belongs to the seeded queue: a page with another `rows` (or none, 5) seeds afresh. */
export function currentRows(size?: number): ReviewRow[] {
  return ensure(size != null && size > 0 ? size : 5);
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

/**
 * FLOW-309: `&fit=1` turns the first card into the short-phone worst case: a supplier name that
 * wraps at 320, Jev's reason line, and the plural filed-today banner. Invented names.
 */
export const E2E_FIT_SUPPLIER = "חומרי בניין ואינסטלציה לדוגמה בע״מ";

export function e2eFitRows(rows: ReviewRow[]): ReviewRow[] {
  return rows.map((row) => row.id === "r1"
    ? { ...row, supplier_name: E2E_FIT_SUPPLIER, project_suggested: true, category_suggested: true, auto_approved_today: 12 }
    : { ...row, auto_approved_today: 12 });
}

export const e2eFitJev: JevQueueData = {
  connectorOn: true,
  byId: {
    "t-r1": {
      suggestionId: "s-fit",
      transactionId: "t-r1",
      project: { id: "p1", name: "הרצל" },
      category: { id: "c1", name: "חומרים" },
      why: { reason: "usual_for_party", partyFilings: 5, matchingFilings: 4 },
    },
  },
};
