/**
 * The parts of a loan payment, in the order the sheet lists them (FLOW-114, option B). Kept apart
 * from the sheet so the cash lists (FLOW-442) can name a part without loading the sheet on Home.
 */
export type LoanPartKey = "principal" | "interest" | "escrow" | "fees";

export const LOAN_PART_ORDER: readonly LoanPartKey[] = ["principal", "interest", "escrow", "fees"];

export const LOAN_PART_LABEL: Record<LoanPartKey, string> = {
  principal: "קרן",
  interest: "ריבית",
  escrow: "מסים וביטוח",
  fees: "עמלות",
};
