import type { ReviewRow } from "@flow/shared";
import type { JevQueueData } from "../screens/jev-review";
import type { ChangeChoice } from "../ui/change-sheet-copy";

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

/**
 * FLOW-365: `&case=` seeds one card in a board state, in USD with round amounts and invented names:
 * suggest (Jev's project and category), none (no suggestion), split (two parts, the summary on the
 * card), photo (a photographed invoice).
 */
export type ReviewCase = "suggest" | "none" | "split" | "photo";
let seedCase: ReviewCase | null = null;

function caseRow(kind: ReviewCase): ReviewRow {
  const base: ReviewRow = {
    id: "r1",
    transaction_id: "t-r1",
    description: "Lark Hardware Co",
    doc_date: "2026-10-08",
    amount_net: -128_450n,
    currency: "USD",
    direction: "expense",
    reason: null,
    project_id: "p1",
    category_id: "c1",
    project_name: "Lark Hill",
    category_name: "חומרים",
    project_suggested: true,
    category_suggested: true,
    supplier_name: "Lark Hardware Co",
    doc_kind: "invoice",
    source: "photo",
    auto_approved_today: 12,
  };
  if (kind === "none") return { ...base, project_id: null, project_name: null, project_suggested: false, category_suggested: false, supplier_name: "ספק חדש לדוגמה", source: "mercury" };
  if (kind === "split") return { ...base, project_id: null, project_name: null, category_id: null, category_name: null, project_suggested: false, category_suggested: false, reason: null, pnl_role: "shared", share_count: 3, supplier_name: "ספק ציוד לדוגמה" };
  if (kind === "photo") return { ...base, source: "photo", supplier_name: "חשמל לדוגמה" };
  return base;
}

/** The split parts a dev card shows (the live read is off in previews). */
export function e2eSplitParts(transactionId: string | null | undefined): Array<{ project: string; category: string; amount: string; rest: boolean }> | null {
  if (transactionId !== "t-r1" || seedCase !== "split") return null;
  return [
    { project: "שיפוץ הרצל 12", category: "ציוד והשכרה", amount: "$340.00", rest: false },
    { project: "וילה רעננה", category: "חומרים", amount: "$420.00", rest: false },
    { project: "שיפוץ הרצל 12", category: "חומרים", amount: "$524.50", rest: true },
  ];
}

/** `size` is the page's request; without one, the queue already seeded stands (dismiss, restore). */
function ensure(size?: number, kind?: ReviewCase | null): ReviewRow[] {
  const nextCase = kind ?? null;
  if (e2eOpen == null || (size != null && size !== seedSize) || nextCase !== seedCase) {
    seedSize = size ?? 5;
    seedCase = nextCase;
    e2eGone = [];
    e2eOpen = nextCase != null ? [caseRow(nextCase), ...seed().slice(1)] : seed();
  }
  return e2eOpen;
}

/** The size belongs to the seeded queue: a page with another `rows` (or none, 5) seeds afresh. */
export function currentRows(size?: number, kind?: ReviewCase | null): ReviewRow[] {
  return ensure(size != null && size > 0 ? size : 5, kind);
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function dismissE2eReview(id: string): void {
  const open = ensure(undefined, seedCase);
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

/** The project list the picker sheet shows in a preview (the live dashboard read is off there). Invented names. */
export const e2eProjectChoices: ChangeChoice[] = [
  { id: "p1", name: "שיפוץ הרצל 12", code: "P-12", status: "active" },
  { id: "p2", name: "וילה רעננה", code: "P-07", status: "active" },
  { id: "p3", name: "מחסן הנמל", code: "P-03", status: "finished" },
];
