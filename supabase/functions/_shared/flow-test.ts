/** Flow Test (SUMIT 2389917160) split rules. From packages/shared/fixtures/demo-data.json. Decision 0050. */

export const FLOW_TEST_SUMIT_COMPANY_ID = 2389917160;

export const FLOW_TEST_EXEMPT_SUPPLIERS = ['ביטוח המגן בע"מ'];

/** Supplier display name → default category. Unknown suppliers land on אחר and in the review queue. */
export const FLOW_TEST_SUPPLIER_CATEGORY: Record<string, string> = {
  'חומרי בניין השרון בע"מ': "חומרים",
  "י.ש. אינסטלציה ושיפוצים": "קבלני משנה",
  "אבי חשמלאי": "קבלני משנה",
  'ש.ב. קבלנות משנה בע"מ': "קבלני משנה",
  'אלומיניום הדר בע"מ': "חומרים",
  'מנופי המרכז בע"מ': "ציוד והשכרה",
  "עץ ופרגולות הגליל": "חומרים",
  'כוח אדם מקצועי א.ר. בע"מ': "עבודה",
  "לוי את שות' - רואי חשבון": "אחר",
  'ביטוח המגן בע"מ': "ביטוח",
  'דרך ליסינג בע"מ': "אחר",
  'דלק הצפון בע"מ': "הובלה",
  'תקשורת פלוס בע"מ': "אחר",
};

/** Worker-days per month, keyed by the project name in SUMIT. */
export const FLOW_TEST_WORKER_DAYS: Record<string, Record<string, number>> = {
  "2026-04": { "שיפוץ דירה ביאליק 8 חולון": 40 },
  "2026-05": { "שיפוץ דירה ביאליק 8 חולון": 40 },
  "2026-06": {
    "שיפוץ דירה ביאליק 8 חולון": 24,
    "שיפוץ הרצל 12": 8,
    "שיפוץ משרדים טק-ליין פתח תקווה": 8,
  },
  "2026-07": {
    "שיפוץ דירה ביאליק 8 חולון": 8,
    "שיפוץ הרצל 12": 12,
    "שיפוץ משרדים טק-ליין פתח תקווה": 12,
    "שיפוץ מטבח ואמבטיה - לוי רעננה": 8,
  },
  "2026-08": {
    "שיפוץ הרצל 12": 12,
    "שיפוץ משרדים טק-ליין פתח תקווה": 14,
    "שיפוץ מטבח ואמבטיה - לוי רעננה": 8,
    "פרגולה בית כהן": 6,
  },
  "2026-09": {
    "שיפוץ הרצל 12": 10,
    "שיפוץ משרדים טק-ליין פתח תקווה": 12,
    "שיפוץ מטבח ואמבטיה - לוי רעננה": 8,
    "פרגולה בית כהן": 6,
    "תוספת בנייה - אברהם מודיעין": 4,
  },
};

/** Same remainder rule as packages/shared allocateByWeights. Parts sum to total. */
export function allocateByWeights(total: bigint, weights: number[]): bigint[] {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const negative = total < 0n;
  const abs = negative ? -total : total;
  const sum = BigInt(weightSum);
  const base = weights.map((weight) => (abs * BigInt(weight)) / sum);
  let leftover = abs - base.reduce((sumAgorot, part) => sumAgorot + part, 0n);
  const ranked = weights
    .map((weight, index) => ({ index, remainder: (abs * BigInt(weight)) % sum }))
    .sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  for (const entry of ranked) {
    if (leftover === 0n) break;
    base[entry.index] = (base[entry.index] ?? 0n) + 1n;
    leftover -= 1n;
  }
  return negative ? base.map((part) => -(part ?? 0n)) : base;
}

export function shareBp(weights: number[]): number[] {
  return allocateByWeights(10000n, weights).map((part) => Number(part));
}
