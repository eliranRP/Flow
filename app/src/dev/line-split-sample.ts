import type { PayloadPart, ServerPart } from "../line-split";

/**
 * A stand-in for `save_line_split(..., p_preview => true)` in stories, unit tests and the dev
 * e2e route, where there is no database. The app never imports it outside a story, a test or an
 * `import.meta.env.DEV` branch: live cents always come from the server (decision 0123).
 * Throws an Error whose message is the server's reason, like PostgREST.
 */
export function samplePreview(
  lineMinor: bigint,
  lineCategoryId: string | null,
  parts: readonly PayloadPart[],
  isReversal: (categoryId: string) => boolean = () => false,
): ServerPart[] {
  if (parts.length === 0) return [];
  if (lineMinor === 0n) throw new Error("line amount is zero");
  const seen = new Set<string>();
  let restAt = -1;
  const rows = parts.map((part, index) => {
    const rest = "rest" in part;
    if (rest) restAt = index;
    const categoryId = part.category_id ?? lineCategoryId;
    if (categoryId == null) throw new Error("line has no category for the rest");
    const projectId = part.project_id ?? null;
    const pair = `${categoryId}|${projectId ?? ""}`;
    if (seen.has(pair)) throw new Error("same category and project twice");
    seen.add(pair);
    if (projectId == null && categoryId !== lineCategoryId && isReversal(categoryId)) {
      throw new Error("a reversal part needs a project");
    }
    return {
      category_id: categoryId,
      project_id: projectId,
      amount_minor: "amount_minor" in part ? BigInt(part.amount_minor) : 0n,
      percent: "percent" in part ? part.percent : null,
      rest,
    };
  });
  const hundredths = rows.reduce((sum, row) => sum + (row.percent == null ? 0n : BigInt(Math.round(row.percent * 100))), 0n);
  if (hundredths > 10_000n) throw new Error("parts exceed the line");
  const fixed = rows.reduce((sum, row) => sum + (row.percent == null && !row.rest ? row.amount_minor : 0n), 0n);
  let percentMinor = 0n;
  if (hundredths > 0n) {
    percentMinor = hundredths === 10_000n ? lineMinor : (lineMinor * hundredths * 2n + 10_000n) / 20_000n;
    const shares = rows.flatMap((row, index) => {
      if (row.percent == null) return [];
      const scaled = lineMinor * BigInt(Math.round(row.percent * 100));
      return [{ index, base: scaled / 10_000n, frac: scaled % 10_000n }];
    });
    for (const share of shares) {
      const row = rows[share.index];
      if (row) row.amount_minor = share.base;
    }
    let left = percentMinor - shares.reduce((sum, share) => sum + share.base, 0n);
    const order = [...shares].sort((a, b) => (b.frac === a.frac ? a.index - b.index : b.frac > a.frac ? 1 : -1));
    for (const share of order) {
      if (left <= 0n) break;
      const row = rows[share.index];
      if (row) row.amount_minor += 1n;
      left -= 1n;
    }
    if (shares.some((share) => rows[share.index]?.amount_minor === 0n)) throw new Error("a part rounds to zero");
  }
  if (fixed + percentMinor > lineMinor) throw new Error("parts exceed the line");
  if (restAt < 0) {
    if (fixed + percentMinor !== lineMinor) throw new Error("parts must sum to the line");
  } else {
    const restRow = rows[restAt];
    const restMinor = lineMinor - fixed - percentMinor;
    if (restRow) restRow.amount_minor = restMinor;
    if (restMinor === 0n && rows.length - 1 < 2) throw new Error("nothing is left for the rest");
  }
  return rows.filter((row) => row.amount_minor > 0n);
}

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

type SampleLine = {
  id: string;
  amountNet: bigint;
  direction: "income" | "expense";
  currency: string;
  categoryId: string | null;
  categoryName: string | null;
  projectId: string | null;
  projectName: string | null;
  supplier: string;
  docDate: string;
  reviewBlocked: boolean;
  loanSplit: boolean;
};

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
): { preview: (parts: PayloadPart[]) => Promise<ServerPart[]>; save: (parts: PayloadPart[]) => Promise<void> } {
  const lineMinor = line.amountNet < 0n ? -line.amountNet : line.amountNet;
  const reversal = (categoryId: string) => {
    const kind = SAMPLE_SPLIT_CATEGORIES.find((category) => category.id === categoryId)?.kind;
    return kind != null && kind !== line.direction;
  };
  return {
    preview: (parts) => {
      try {
        return Promise.resolve(samplePreview(lineMinor, line.categoryId, parts, reversal));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error("validation"));
      }
    },
    save: async (parts) => {
      if (parts.length > 0) samplePreview(lineMinor, line.categoryId, parts, reversal);
      await onSave?.(parts);
    },
  };
}
