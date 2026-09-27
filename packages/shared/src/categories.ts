/**
 * Default categories, decision 0008. This list is the source.
 * The schema trigger in supabase/migrations must insert the same names,
 * in this order. categories.test.ts checks the migration text.
 */
export const DEFAULT_EXPENSE_CATEGORIES = [
  "חומרים",
  "קבלני משנה",
  "עבודה",
  "ציוד והשכרה",
  "הובלה",
  "ביטוח",
  "אחר",
] as const;

export const DEFAULT_INCOME_CATEGORIES = ["תקבול מלקוח", "הכנסה אחרת"] as const;
