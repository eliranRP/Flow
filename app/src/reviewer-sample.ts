import type { FiledTodayRow, ReviewRow } from "@flow/shared";
import { allocate, incomeBasis, type SplitProject } from "./split-math";

/**
 * Sample books for the dev-only reviewer preview.
 * Agorot. Expenses are negative on a row and positive on a line.
 * None of these totals are the golden answer key.
 */

export const reviewerIncomeAgorot = 180_000n;
/** The מלט line is these two rows. A paged sample shows them one at a time. */
export const reviewerMaterialsPageAgorot = [14_000n, 8_000n] as const;
export const reviewerMaterialsAgorot = reviewerMaterialsPageAgorot[0] + reviewerMaterialsPageAgorot[1];
export const reviewerHaulAgorot = 18_000n;
export const reviewerWaitingBoltsAgorot = 15_000n;
export const reviewerWaitingPaintAgorot = 30_000n;
export const reviewerSharedAgorot = 100_000n;
export const reviewerOtherIncomeAgorot = 120_000n;

export const reviewerProjectName = "בית הספר אלון";
export const reviewerOtherProjectName = "מחסן הנמל";
export const reviewerSplitProjects: SplitProject[] = [
  { id: "p-alon", name: reviewerProjectName, incomeAgorot: reviewerIncomeAgorot },
  { id: "p-raanana", name: reviewerOtherProjectName, incomeAgorot: reviewerOtherIncomeAgorot },
];

export const reviewerProjectChoices = reviewerSplitProjects.map((project) => ({
  id: project.id,
  name: project.name,
}));

export const reviewerCategories = [
  { id: "c-materials", name: "מלט" },
  { id: "c-haul", name: "שינוע" },
];

function expenseVat(net: bigint): bigint {
  const abs = net < 0n ? -net : net;
  return -((abs * 18n) / 100n);
}

/** An approved split. Its amount stays out of the אושרו total; the list shows the shares. */
export const reviewerApprovedSplitId = "t-sample-split";

export const reviewerApprovedShares = [
  { name: reviewerProjectName, bp: 6000, amount: 12_000n },
  { name: reviewerOtherProjectName, bp: 4000, amount: 8_000n },
] as const;

/** ברגי העמק is ₪150 across the two sample projects, half each. */
export const reviewerBoltsShares = [
  { name: reviewerProjectName, bp: 5000, amount: 7_500n },
  { name: reviewerOtherProjectName, bp: 5000, amount: 7_500n },
] as const;

export type ReviewerShare = { name: string; bp: number; amount: bigint };

export const reviewerFiled: FiledTodayRow[] = [
  {
    id: "t-sample-sand",
    description: "חול",
    doc_date: "2026-09-29",
    amount_net: -reviewerMaterialsPageAgorot[0],
    direction: "expense",
    supplier_name: "מחצבת הדקל בע״מ",
    project_name: reviewerProjectName,
    category_name: "מלט",
  },
  {
    id: "t-sample-cement",
    description: "מלט",
    doc_date: "2026-09-29",
    amount_net: -reviewerMaterialsPageAgorot[1],
    direction: "expense",
    supplier_name: "סיד האבן בע״מ",
    project_name: reviewerProjectName,
    category_name: "מלט",
  },
  {
    id: "t-sample-haul",
    description: "הובלה קצרה",
    doc_date: "2026-09-29",
    amount_net: -reviewerHaulAgorot,
    direction: "expense",
    supplier_name: "שינוע הנמל בע״מ",
    project_name: reviewerProjectName,
    category_name: "שינוע",
  },
  {
    id: reviewerApprovedSplitId,
    description: "ליסינג",
    doc_date: "2026-09-29",
    amount_net: -20_000n,
    direction: "expense",
    supplier_name: "ליסינג הדרך בע״מ",
    project_name: "מפוצל · 2 פרויקטים",
    category_name: "שינוע",
  },
];

export const reviewerQueue: ReviewRow[] = [
  {
    id: "q-shared",
    transaction_id: "t-shared",
    description: "מנוף ליום",
    doc_date: "2026-09-29",
    amount_net: -reviewerSharedAgorot,
    direction: "expense",
    reason: "unallocated_shared",
    pnl_role: "shared",
    share_count: 0,
    project_id: null,
    category_id: null,
    supplier_name: "עגורני החוף בע״מ",
    project_name: null,
    category_name: null,
    doc_kind: "invoice",
    vat_agorot: expenseVat(-reviewerSharedAgorot),
    auto_approved_today: reviewerFiled.length,
  },
  {
    id: "q-bolts",
    transaction_id: "t-bolts",
    description: "ברגים",
    doc_date: "2026-09-28",
    amount_net: -reviewerWaitingBoltsAgorot,
    direction: "expense",
    reason: "missing_category",
    pnl_role: "shared",
    share_count: 2,
    project_id: "p-alon",
    category_id: null,
    supplier_name: "ברגי העמק בע״מ",
    project_name: reviewerProjectName,
    category_name: null,
    doc_kind: "invoice",
    vat_agorot: expenseVat(-reviewerWaitingBoltsAgorot),
    auto_approved_today: reviewerFiled.length,
  },
  {
    id: "q-paint",
    transaction_id: "t-paint",
    description: "צבע",
    doc_date: "2026-09-27",
    amount_net: -reviewerWaitingPaintAgorot,
    direction: "expense",
    reason: null,
    project_id: "p-alon",
    category_id: "c-materials",
    supplier_name: "צבעי הכרמל בע״מ",
    project_name: reviewerProjectName,
    category_name: "מלט",
    project_suggested: true,
    category_suggested: true,
    doc_kind: "invoice",
    vat_agorot: expenseVat(-reviewerWaitingPaintAgorot),
    auto_approved_today: reviewerFiled.length,
  },
];

type CategoryPatch = { category_id: string; category_name: string; category_suggested: false };

const categoryPatches = new Map<string, CategoryPatch>();
const queueListeners = new Set<() => void>();
/** Stable for useSyncExternalStore. A fresh array on every read loops the queue. */
let queueViewCache: ReviewRow[] | null = null;

/** The queue the reviewer is showing, including a category saved on a split. */
export function reviewerQueueView(): ReviewRow[] {
  if (queueViewCache) return queueViewCache;
  if (categoryPatches.size === 0) {
    queueViewCache = reviewerQueue;
    return queueViewCache;
  }
  queueViewCache = reviewerQueue.map((row) => {
    const patch = categoryPatches.get(row.id);
    return patch ? { ...row, ...patch } : row;
  });
  return queueViewCache;
}

export function patchReviewerCategory(id: string, categoryId: string, categoryName: string): void {
  categoryPatches.set(id, { category_id: categoryId, category_name: categoryName, category_suggested: false });
  queueViewCache = null;
  for (const listener of queueListeners) listener();
}

export function subscribeReviewerQueue(listener: () => void): () => void {
  queueListeners.add(listener);
  return () => {
    queueListeners.delete(listener);
  };
}

const filedExtras: FiledTodayRow[] = [];
const filedShares = new Map<string, readonly ReviewerShare[]>();
let filedViewCache: FiledTodayRow[] | null = null;
const filedListeners = new Set<() => void>();

function notifyFiled(): void {
  filedViewCache = null;
  for (const listener of filedListeners) listener();
}

/** The filed list, including a split approved during this visit. */
export function reviewerFiledView(): FiledTodayRow[] {
  if (filedViewCache) return filedViewCache;
  filedViewCache = [...filedExtras, ...reviewerFiled];
  return filedViewCache;
}

/** Every שויכו היום row, including the seeded split and one approved on this visit. */
export function reviewerFiledCount(): number {
  return reviewerFiledView().length;
}

export function reviewerSharesFor(id: string): readonly ReviewerShare[] | null {
  if (id === reviewerApprovedSplitId) return reviewerApprovedShares;
  return filedShares.get(id) ?? null;
}

export function subscribeReviewerFiled(listener: () => void): () => void {
  filedListeners.add(listener);
  return () => {
    filedListeners.delete(listener);
  };
}

/** An approved split joins שויכו היום with its shares. A plain approval is already represented by the sample rows. */
export function fileReviewerApproval(reviewId: string): void {
  const row = reviewerQueueView().find((item) => item.id === reviewId);
  if (!row) return;
  const split = row.pnl_role === "shared" || (row.share_count ?? 0) > 1;
  if (!split || row.reason === "unallocated_shared") return;
  const id = row.transaction_id;
  if (filedExtras.some((item) => item.id === id)) return;
  const count = row.share_count ?? 0;
  filedExtras.unshift({
    id,
    description: row.description,
    doc_date: row.doc_date,
    amount_net: row.amount_net,
    direction: row.direction,
    supplier_name: row.supplier_name ?? null,
    project_name: count > 1 ? `מפוצל · ${String(count)} פרויקטים` : (row.project_name ?? null),
    category_name: row.category_name ?? null,
  });
  if (id === "t-bolts") filedShares.set(id, reviewerBoltsShares);
  notifyFiled();
}

/** ביטול takes that split back off שויכו היום. */
export function unfileReviewerApproval(reviewId: string): void {
  const row = reviewerQueue.find((item) => item.id === reviewId);
  const id = row?.transaction_id ?? reviewId;
  const index = filedExtras.findIndex((item) => item.id === id);
  if (index < 0) return;
  filedExtras.splice(index, 1);
  filedShares.delete(id);
  notifyFiled();
}

export type SampleSave = "ok" | "fail" | "offline" | "shared";

export function sampleSaveMode(value: string | null): SampleSave {
  if (value === "fail" || value === "offline" || value === "shared") return value;
  return "ok";
}

export function reviewerBooks() {
  const approved = reviewerMaterialsAgorot + reviewerHaulAgorot;
  const filed = reviewerFiled
    .filter((row) => row.id !== reviewerApprovedSplitId)
    .reduce((sum, row) => sum - row.amount_net, 0n);
  const waiting = reviewerWaitingBoltsAgorot + reviewerWaitingPaintAgorot;
  const projectExpenses = approved + waiting;
  const profit = reviewerIncomeAgorot - projectExpenses;
  const basis = incomeBasis(reviewerSplitProjects);
  const split = allocate(
    reviewerSharedAgorot,
    reviewerSplitProjects.map((project) => ({ id: project.id, bp: basis[project.id] ?? 0 })),
  );
  const queueTotal = reviewerQueue.reduce((sum, row) => sum - row.amount_net, 0n);
  return {
    income: reviewerIncomeAgorot,
    materials: reviewerMaterialsAgorot,
    haul: reviewerHaulAgorot,
    approved,
    filed,
    waiting,
    projectExpenses,
    profit,
    shared: reviewerSharedAgorot,
    otherIncome: reviewerOtherIncomeAgorot,
    filedCount: reviewerFiledCount(),
    bannerCount: reviewerFiledCount(),
    split,
    splitSum: split.reduce((sum, part) => sum + part.agorot, 0n),
    bpSum: split.reduce((sum, part) => sum + part.bp, 0),
    queueTotal,
    vatMatches: reviewerQueue.every((row) => row.vat_agorot === expenseVat(row.amount_net)),
  };
}

/** Named lines, the waiting line, the queue, and the income split are one set of books. */
export function reviewerBooksAddUp(): boolean {
  const books = reviewerBooks();
  return books.filed === books.approved
    && books.filed === books.materials + books.haul
    && books.projectExpenses === books.approved + books.waiting
    && books.profit === books.income - books.projectExpenses
    && books.filedCount === books.bannerCount
    && books.bannerCount === reviewerFiledCount()
    && books.splitSum === books.shared
    && books.bpSum === 10000
    && books.queueTotal === books.shared + books.waiting
    && books.vatMatches
    && reviewerMaterialsPageAgorot[0] + reviewerMaterialsPageAgorot[1] === books.materials;
}
