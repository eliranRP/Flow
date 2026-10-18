import type { PayloadPart, ServerPart } from "./line-split";
import type { LineSplitApi } from "./screens/line-split-parts";

/**
 * A stand-in for `save_line_split(..., p_preview => true)` in the samples: stories, unit tests,
 * the dev e2e route and the reviewer's sample split. The live screen never calls it: live cents
 * come from the server (decision 0123). Throws an Error whose message is the server's reason,
 * like PostgREST. Prod-safe: it imports nothing from dev.
 */
export function samplePreview(
  lineMinor: bigint,
  lineCategoryId: string | null,
  parts: readonly PayloadPart[],
  isReversal: (categoryId: string) => boolean = () => false,
  /** A kept-out reversal part needs no project unless the line is in the P&L (0138). */
  keptOut: (categoryId: string) => boolean = () => false,
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
    if (projectId == null && categoryId !== lineCategoryId && isReversal(categoryId) && !keptOut(categoryId)) {
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

/** The line fields a sample api reads: the amount's sign gives the side, the category its rest. */
export type SampleLine = {
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

/**
 * An api for a sample line: `samplePreview` as the preview, and a save that hands what it was
 * sent to `onSave` after the same checks. `isReversal` says which categories need a project.
 */
export function sampleApi(
  line: Pick<SampleLine, "amountNet" | "categoryId" | "direction">,
  isReversal: (categoryId: string) => boolean,
  onSave?: (parts: PayloadPart[]) => void | Promise<void>,
): LineSplitApi {
  const lineMinor = line.amountNet < 0n ? -line.amountNet : line.amountNet;
  return {
    preview: (parts) => {
      try {
        return Promise.resolve(samplePreview(lineMinor, line.categoryId, parts, isReversal));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error("validation"));
      }
    },
    save: async (parts) => {
      if (parts.length > 0) samplePreview(lineMinor, line.categoryId, parts, isReversal);
      await onSave?.(parts);
    },
  };
}
