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
/** FLOW-309: `&rows=N` seeds N cards (7 by default), so the counter can step 9→10 or the queue can empty. */
let seedSize = 7;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * FLOW-365: the seeded queue in USD with round, varied amounts and invented payees, in the board's
 * order: two receipts and five bank lines (one income, one with no project), each its own date.
 */
type SeedSpec = {
  supplier: string;
  date: string;
  minor: bigint;
  source: "photo" | "mercury";
  direction?: "income" | "expense";
  project?: boolean;
};
const SEED: readonly SeedSpec[] = [
  { supplier: "Cedar Hardware Co", date: "2026-10-08", minor: 128_450n, source: "photo" },
  { supplier: "Ridge Plumbing Co", date: "2026-10-09", minor: 240_000n, source: "mercury" },
  { supplier: "J. Ortega • שכר דירה", date: "2026-10-09", minor: 185_000n, source: "mercury", direction: "income" },
  { supplier: "Maple Lumber", date: "2026-10-10", minor: 45_000n, source: "photo", project: false },
  { supplier: "Coastal Water Co.", date: "2026-10-10", minor: 9_000n, source: "mercury" },
  { supplier: "העברה לחיסכון לדוגמה", date: "2026-10-10", minor: 500_000n, source: "mercury" },
  { supplier: "Quill Insurance Co", date: "2026-10-11", minor: 125_000n, source: "mercury" },
];

function seed(): ReviewRow[] {
  const specs: SeedSpec[] = [...SEED];
  for (let n = SEED.length + 1; n <= seedSize; n += 1) {
    specs.push({ supplier: `ספק בדיקה ${String(n)}`, date: "2026-10-12", minor: BigInt(n) * 1_000n, source: "photo" });
  }
  return specs.slice(0, seedSize).map((spec, index) => {
    const id = `r${String(index + 1)}`;
    const income = spec.direction === "income";
    return {
      id,
      transaction_id: `t-${id}`,
      description: spec.supplier,
      doc_date: spec.date,
      amount_net: income ? spec.minor : -spec.minor,
      currency: "USD",
      direction: income ? "income" as const : "expense" as const,
      reason: null,
      project_id: spec.project === false ? null : "p1",
      category_id: "c1",
      project_name: spec.project === false ? null : "שיפוץ הרצל 12",
      category_name: "חומרים",
      project_suggested: false,
      category_suggested: false,
      supplier_name: spec.supplier,
      doc_kind: spec.source === "photo" ? "invoice" : "bank",
      source: spec.source,
      auto_approved_today: 0,
    };
  });
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
    description: "Cedar Hardware Co",
    doc_date: "2026-10-08",
    amount_net: -128_450n,
    currency: "USD",
    direction: "expense",
    reason: null,
    project_id: "p1",
    category_id: "c1",
    project_name: "Maple Ridge",
    category_name: "חומרים",
    project_suggested: true,
    category_suggested: true,
    supplier_name: "Cedar Hardware Co",
    doc_kind: "invoice",
    source: "photo",
    auto_approved_today: 12,
  };
  if (kind === "none") return { ...base, project_id: null, project_name: null, project_suggested: false, category_suggested: false, supplier_name: "Northwind Supply", source: "mercury" };
  if (kind === "split") return { ...base, project_id: null, project_name: null, category_id: null, category_name: null, project_suggested: false, category_suggested: false, reason: null, pnl_role: "shared", share_count: 3, supplier_name: "Summit Equipment" };
  if (kind === "photo") return { ...base, source: "photo", supplier_name: "Voltline Electric" };
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
    seedSize = size ?? 7;
    seedCase = nextCase;
    e2eGone = [];
    e2eOpen = nextCase != null ? [caseRow(nextCase), ...seed().slice(1)] : seed();
  }
  return e2eOpen;
}

/** The size belongs to the seeded queue: a page with another `rows` (or none, 5) seeds afresh. */
export function currentRows(size?: number, kind?: ReviewCase | null): ReviewRow[] {
  return ensure(size != null && size > 0 ? size : 7, kind);
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
  supplier: "Harbor Hardware",
  amount: "$1,200",
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

/** FLOW-365: the suggest case's Jev read: a supplier that repeats its project, so Jev's line sits under the card. */
export const e2eSuggestJev: JevQueueData = {
  connectorOn: true,
  byId: {
    "t-r1": {
      suggestionId: "s-suggest",
      transactionId: "t-r1",
      project: { id: "p1", name: "שיפוץ הרצל 12" },
      category: { id: "c1", name: "חומרים" },
      why: { reason: "usual_for_party", partyFilings: 6, matchingFilings: 6 },
    },
  },
};
