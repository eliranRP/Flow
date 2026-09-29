import type { FiledTodayRow, ReviewRow } from "@flow/shared";
import { allocate, incomeBasis, type SplitProject } from "./split-math";

/**
 * Sample books for the dev-only reviewer preview.
 * Agorot. Expenses are negative on a row and positive on a line.
 * None of these totals are the golden answer key.
 */

export const reviewerIncomeAgorot = 180_000n;
export const reviewerMaterialsAgorot = 22_000n;
export const reviewerHaulAgorot = 18_000n;
export const reviewerWaitingBoltsAgorot = 15_000n;
export const reviewerWaitingPaintAgorot = 30_000n;
export const reviewerSharedAgorot = 100_000n;
export const reviewerOtherIncomeAgorot = 120_000n;

export const reviewerSplitProjects: SplitProject[] = [
  { id: "p-herzl", name: "שיפוץ הרצל 12", incomeAgorot: reviewerIncomeAgorot },
  { id: "p-raanana", name: "וילה רעננה", incomeAgorot: reviewerOtherIncomeAgorot },
];

export const reviewerProjectChoices = reviewerSplitProjects.map((project) => ({
  id: project.id,
  name: project.name,
}));

export const reviewerCategories = [
  { id: "c-materials", name: "חומרים" },
  { id: "c-haul", name: "הובלה" },
];

function expenseVat(net: bigint): bigint {
  const abs = net < 0n ? -net : net;
  return -((abs * 18n) / 100n);
}

export const reviewerFiled: FiledTodayRow[] = [
  {
    id: "t-sample-sand",
    description: "חול",
    doc_date: "2026-09-29",
    amount_net: -reviewerMaterialsAgorot,
    direction: "expense",
    supplier_name: "מחצבות השרון בע״מ",
    project_name: "שיפוץ הרצל 12",
    category_name: "חומרים",
  },
  {
    id: "t-sample-haul",
    description: "הובלה קצרה",
    doc_date: "2026-09-29",
    amount_net: -reviewerHaulAgorot,
    direction: "expense",
    supplier_name: "הובלות הגליל בע״מ",
    project_name: "שיפוץ הרצל 12",
    category_name: "הובלה",
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
    project_id: null,
    category_id: null,
    supplier_name: "מנופי המרכז בע״מ",
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
    project_id: "p-herzl",
    category_id: null,
    supplier_name: "ברגי הצפון בע״מ",
    project_name: "שיפוץ הרצל 12",
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
    project_id: "p-herzl",
    category_id: "c-materials",
    supplier_name: "צבעי הגליל בע״מ",
    project_name: "שיפוץ הרצל 12",
    category_name: "חומרים",
    doc_kind: "invoice",
    vat_agorot: expenseVat(-reviewerWaitingPaintAgorot),
    auto_approved_today: reviewerFiled.length,
  },
];

export type SampleSave = "ok" | "fail" | "offline" | "shared";

export function sampleSaveMode(value: string | null): SampleSave {
  if (value === "fail" || value === "offline" || value === "shared") return value;
  return "ok";
}

export function reviewerBooks() {
  const approved = reviewerMaterialsAgorot + reviewerHaulAgorot;
  const filed = reviewerFiled.reduce((sum, row) => sum - row.amount_net, 0n);
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
    filedCount: reviewerFiled.length,
    bannerCount: reviewerQueue[0]?.auto_approved_today ?? 0,
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
    && books.bannerCount === reviewerFiled.length
    && books.splitSum === books.shared
    && books.bpSum === 10000
    && books.queueTotal === books.shared + books.waiting
    && books.vatMatches;
}
