import type { LineSplitRead, PartDraft, PayloadPart, RestDraft } from "../line-split";
import { sampleApi, type SampleLine } from "../line-split-preview";
import type { LineSplitApi } from "../screens/line-split-parts";

/** Invented categories and projects for stories, tests and the dev route. No real data. */
export const SAMPLE_SPLIT_CATEGORIES = [
  { id: "c-build", name: "חומרי בניין", kind: "expense" as const, hidden: false },
  { id: "c-elec", name: "חשמל", kind: "expense" as const, hidden: false },
  { id: "c-ins", name: "ביטוח", kind: "expense" as const, hidden: false },
  { id: "c-subs", name: "קבלני משנה", kind: "expense" as const, hidden: false },
  { id: "c-refund", name: "החזרים", kind: "income" as const, hidden: false },
  { id: "c-sales", name: "הכנסות מפרויקט", kind: "income" as const, hidden: false },
];

export const SAMPLE_SPLIT_PROJECTS = [
  { id: "p-herz", name: "פרויקט הרצליה", status: "active" as const },
  { id: "p-raan", name: "פרויקט רעננה", status: "active" as const },
  { id: "p-givat", name: "פרויקט גבעתיים", status: "active" as const },
  { id: "p-office", name: "משרד", status: "active" as const },
];

/** ₪4,800 to a building supplier, filed as building materials on the Givatayim project. */
export const SAMPLE_EXPENSE_LINE: SampleLine = {
  id: "t-lsplit-expense",
  amountNet: -480_000n,
  direction: "expense",
  currency: "ILS",
  categoryId: "c-build",
  categoryName: "חומרי בניין",
  projectId: "p-givat",
  projectName: "פרויקט גבעתיים",
  supplier: "חומרי בניין אלון",
  docDate: "2026-10-06",
  reviewBlocked: false,
  loanSplit: false,
};

/** A ₪1,250 refund from a tile supplier, filed as refunds on the office project. */
export const SAMPLE_REFUND_LINE: SampleLine = {
  id: "t-lsplit-refund",
  amountNet: 125_000n,
  direction: "income",
  currency: "ILS",
  categoryId: "c-refund",
  categoryName: "החזרים",
  projectId: "p-office",
  projectName: "משרד",
  supplier: "קרמיקה דוד",
  docDate: "2026-10-05",
  reviewBlocked: false,
  loanSplit: false,
};

/** An api for a sample line: the preview above, and a save that records what it was sent. */
export function sampleSplitApi(
  line: SampleLine,
  onSave?: (parts: PayloadPart[]) => void | Promise<void>,
): LineSplitApi {
  const reversal = (categoryId: string) => {
    const kind = SAMPLE_SPLIT_CATEGORIES.find((category) => category.id === categoryId)?.kind;
    return kind != null && kind !== line.direction;
  };
  return sampleApi(line, reversal, onSave);
}

/**
 * FLOW-370 proof fixture: the split board's amounts, dates, counts and order with invented names
 * (lane rule 25). Only `?board=<state>` on the dev route uses it, so the unit tests keep the sample above.
 */
export const BOARD_SPLIT_CATEGORIES = [
  { id: "b-materials", name: "חומרים", kind: "expense" as const, hidden: false },
  { id: "b-labour", name: "עבודה", kind: "expense" as const, hidden: false },
  { id: "b-repairs", name: "תיקונים ותחזוקה", kind: "expense" as const, hidden: false },
  { id: "b-power", name: "חשמל ומים", kind: "expense" as const, hidden: false },
  { id: "b-other", name: "אחר", kind: "expense" as const, hidden: false },
];

export const BOARD_SPLIT_PROJECTS = [
  { id: "b-birch", name: "Birch Lane", status: "active" as const },
  { id: "b-juniper", name: "Juniper Ct", status: "active" as const },
  { id: "b-elm", name: "Elm Row", status: "active" as const },
  { id: "b-sable", name: "Sable Ct", status: "active" as const },
  { id: "b-okafor", name: "Okafor", status: "active" as const },
];

/** 05/10, a $8,940.17 expense to a supplier, filed as materials on the Juniper Ct project. */
export const BOARD_SPLIT_LINE: SampleLine = {
  id: "t-board-split",
  amountNet: -894_017n,
  direction: "expense",
  currency: "USD",
  categoryId: "b-materials",
  categoryName: "חומרים",
  projectId: "b-juniper",
  projectName: "Juniper Ct",
  supplier: "Northline Supply",
  docDate: "2026-10-05",
  reviewBlocked: false,
  loanSplit: false,
};

/** The board's saved split: Birch Lane $6,000 and Sable Ct $2,000, the rest on Juniper Ct. */
export const BOARD_SPLIT_READ: LineSplitRead = {
  transactionId: "t-board-split",
  currency: "USD",
  lineMinor: 894_017n,
  partsMatch: true,
  parts: [
    { category_id: "b-materials", category_name: "חומרים", project_id: "b-birch", project_name: "Birch Lane", amount_minor: 600_000n, percent: null, rest: false },
    { category_id: "b-materials", category_name: "חומרים", project_id: "b-sable", project_name: "Sable Ct", amount_minor: 200_000n, percent: null, rest: false },
    { category_id: "b-materials", category_name: "חומרים", project_id: "b-juniper", project_name: "Juniper Ct", amount_minor: 94_017n, percent: null, rest: true },
  ],
};

/** The five split board frames (FLOW-922). The dev route reads `?board=<state>` and nothing else drives them. */
export type BoardSplitState = "split" | "empty" | "picker" | "over" | "twice";

export const BOARD_SPLIT_STATES: readonly BoardSplitState[] = ["split", "empty", "picker", "over", "twice"];

/** The board's two parts: Birch Lane $6,000 and Sable Ct $2,000, both on materials. */
const BOARD_PART_BIRCH: PartDraft = { key: "board-1", categoryId: "b-materials", projectId: "b-birch", unit: "amount", value: "6000" };
const BOARD_PART_SABLE: PartDraft = { key: "board-2", categoryId: "b-materials", projectId: "b-sable", unit: "amount", value: "2000" };

/** The pieces of a LineSplitSample for one board frame; the line and the lists are the constants above. */
export function boardSplitSample(state: BoardSplitState): {
  split: LineSplitRead | null;
  parts: PartDraft[];
  rest: RestDraft;
  target?: { partKey: string; kind: "project" | "category" };
} {
  const none: RestDraft = { categoryId: null, projectId: null };
  switch (state) {
    case "split":
      return { split: BOARD_SPLIT_READ, parts: [BOARD_PART_BIRCH, BOARD_PART_SABLE], rest: none };
    case "empty":
      return { split: null, parts: [], rest: none };
    case "picker":
      return { split: null, parts: [BOARD_PART_BIRCH, BOARD_PART_SABLE], rest: none, target: { partKey: "board-2", kind: "project" } };
    case "over":
      return { split: null, parts: [BOARD_PART_BIRCH, { ...BOARD_PART_SABLE, value: "3500" }], rest: none };
    case "twice":
      return { split: null, parts: [BOARD_PART_BIRCH, { ...BOARD_PART_BIRCH, key: "board-2", value: "2000" }], rest: none };
  }
}
