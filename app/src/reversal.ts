/** A category as the picker reads it. Only list_categories rows carry kind and the flags. */
export type KindedCategory = {
  id: string;
  name: string;
  kind?: string;
  hidden?: boolean;
  excluded_from_pnl?: boolean;
  loan_part?: string | null;
};

type Direction = "income" | "expense";

/** The picker section for the other kind ([0103](../../docs/decisions/0103-reversals-across-directions.md)). */
export const REVERSAL_HEADING: Record<Direction, string> = {
  expense: "הכנסה שהוחזרה",
  income: "הוצאה שהוחזרה",
};

export const REVERSAL_HINT: Record<Direction, string> = {
  expense: "למשל שכירות שחזרה. מקטין את ההכנסות.",
  income: "למשל החזר מספק. מקטין את ההוצאות.",
};

function ownKind(category: KindedCategory, direction: Direction): boolean {
  return direction === "income" ? category.kind === "income" : category.kind !== "income";
}

/**
 * Categories of the other kind that a line of this direction can be filed under.
 * Hidden, loan and kept-out categories stay out.
 */
export function reversalChoices(categories: readonly KindedCategory[], direction: Direction): Array<{ id: string; name: string }> {
  return categories
    .filter((category) => category.kind != null && !ownKind(category, direction))
    .filter((category) => category.hidden !== true && category.loan_part == null && category.excluded_from_pnl !== true)
    .map((category) => ({ id: category.id, name: category.name }));
}

/** True when the line's category is of the other kind. Unknown ids and kinds are not reversals. */
export function isReversal(categories: readonly KindedCategory[], categoryId: string | null | undefined, direction: Direction): boolean {
  if (categoryId == null || categoryId === "") return false;
  const category = categories.find((entry) => entry.id === categoryId);
  if (category?.kind == null) return false;
  return !ownKind(category, direction);
}
