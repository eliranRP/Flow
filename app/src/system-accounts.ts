// No zod or query code here: Home's reports card reads these names on Home's first load (FLOW-804).

/** Hebrew for the ledger's system accounts (decision 0208); a category account keeps its own name. */
export const SYSTEM_NAMES: Record<string, string> = {
  "Loan principal": "קרן הלוואה",
  Escrow: "פיקדון מסים וביטוח",
  Property: "נכסים",
  "Transfers in transit": "העברות בין חשבונות",
  "Owner capital": "השקעת בעלים",
  "Security deposit held": "פיקדון שהתקבל",
  Suspense: "חשבון מעבר",
  "VAT control": "מע״מ",
  "Uncategorized income": "הכנסה בלי קטגוריה",
  "Uncategorized expense": "הוצאה בלי קטגוריה",
  "Bank/Clearing": "בנק",
  "Accumulated depreciation": "פחת שנצבר",
};
