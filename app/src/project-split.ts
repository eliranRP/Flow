import { amountOf, amountText, percentOf, type PartUnit } from "./line-split";

/**
 * FLOW-346: the split between projects, built like the split by categories. Each part is a
 * project with an exact amount or a percent of the line; the rest stays on one project.
 * Everything is whole minor units, and the parts plus the rest always add up to the line.
 */
export type ProjectPart = { key: string; projectId: string; unit: PartUnit; value: string };

export type ProjectShare = { project_id: string; amount_minor: number };

export type ProjectPartIssue = "missing" | "percent over" | "same project twice";

export type ProjectRestIssue = "no project" | "same project twice";

export type ProjectSplitCheck = {
  /** Each part's cents, or null while its field holds no valid value. */
  minor: Record<string, bigint | null>;
  issues: Record<string, ProjectPartIssue>;
  /** What the rest takes. Negative when the parts pass the line. Null while a part is unreadable. */
  restMinor: bigint | null;
  overMinor: bigint;
  restIssue: ProjectRestIssue | null;
  /** The shares a save sends, in order, the rest last; null while anything is off. */
  shares: ProjectShare[] | null;
};

/**
 * The cents each percent takes, rounded like `save_line_split` (0123): floor each share of the
 * line, then hand the cents still missing from the rounded total to the largest remainders,
 * first part first on a tie. 100% in all is the whole line.
 */
export function percentPartsMinor(percents: readonly number[], lineMinor: bigint): bigint[] {
  const hundredths = percents.map((percent) => BigInt(Math.round(percent * 100)));
  const total = hundredths.reduce((sum, value) => sum + value, 0n);
  if (total === 0n) return percents.map(() => 0n);
  const target = total === 10_000n ? lineMinor : (lineMinor * total * 2n + 10_000n) / 20_000n;
  const base = hundredths.map((value) => (lineMinor * value) / 10_000n);
  const rest = hundredths.map((value) => (lineMinor * value) % 10_000n);
  let missing = target - base.reduce((sum, value) => sum + value, 0n);
  const order = rest.map((value, index) => ({ value, index })).sort((left, right) => (left.value === right.value ? left.index - right.index : left.value > right.value ? -1 : 1));
  for (const { index } of order) {
    if (missing <= 0n) break;
    base[index] = (base[index] ?? 0n) + 1n;
    missing -= 1n;
  }
  return base;
}

export function checkProjectSplit(parts: readonly ProjectPart[], restProjectId: string | null, lineMinor: bigint): ProjectSplitCheck {
  const minor: Record<string, bigint | null> = {};
  const issues: Record<string, ProjectPartIssue> = {};
  const percentKeys: string[] = [];
  const percents: number[] = [];
  for (const part of parts) {
    if (part.unit === "percent") {
      const value = percentOf(part.value);
      if (value == null) {
        minor[part.key] = null;
        issues[part.key] = part.value.trim() !== "" && Number(part.value) > 100 ? "percent over" : "missing";
        continue;
      }
      percentKeys.push(part.key);
      percents.push(value);
    } else {
      const value = amountOf(part.value);
      minor[part.key] = value;
      if (value == null) issues[part.key] = "missing";
    }
  }
  const percentMinor = percentPartsMinor(percents, lineMinor);
  percentKeys.forEach((key, index) => {
    minor[key] = percentMinor[index] ?? 0n;
    if (minor[key] === 0n) issues[key] = "missing";
  });
  const seen = new Set<string>();
  for (const part of parts) {
    if (seen.has(part.projectId) || part.projectId === restProjectId) issues[part.key] ??= "same project twice";
    seen.add(part.projectId);
  }
  const known = parts.every((part) => minor[part.key] != null);
  const used = parts.reduce((sum, part) => sum + (minor[part.key] ?? 0n), 0n);
  const overMinor = used > lineMinor ? used - lineMinor : 0n;
  const restMinor = known ? lineMinor - used : null;
  const restIssue: ProjectRestIssue | null = restMinor != null && restMinor > 0n && restProjectId == null
    ? "no project"
    : null;
  const valid = known && restMinor != null && restMinor >= 0n && overMinor === 0n && restIssue == null
    && Object.keys(issues).length === 0;
  const shares: ProjectShare[] | null = valid
    ? [
        ...parts.map((part) => ({ project_id: part.projectId, amount_minor: Number(minor[part.key] ?? 0n) })),
        ...(restMinor > 0n && restProjectId != null ? [{ project_id: restProjectId, amount_minor: Number(restMinor) }] : []),
      ]
    : null;
  return { minor, issues, restMinor, overMinor, restIssue, shares };
}

/** A key for a new part, unique in the screen's life. */
let partSeq = 0;
export function newProjectPartKey(): string {
  partSeq += 1;
  return `pp${String(partSeq)}`;
}

/**
 * The saved split as editor rows: the largest project keeps the rest, every other share becomes
 * an exact part. A line on one project opens with no parts and that project as the rest.
 */
export function projectDraftFrom(
  lineProjectId: string | null | undefined,
  allocations: ReadonlyArray<{ project_id: string; amount_net: bigint }> | undefined,
): { parts: ProjectPart[]; restProjectId: string | null } {
  const rows = (allocations ?? []).filter((row) => row.amount_net !== 0n);
  if (rows.length >= 2) {
    // The largest project keeps the rest (the first one on a tie), whatever order the line lists them in.
    const size = (row: { amount_net: bigint }) => (row.amount_net < 0n ? -row.amount_net : row.amount_net);
    const largest = rows.reduce((best, row) => (size(row) > size(best) ? row : best));
    const others = rows.filter((row) => row !== largest);
    return {
      restProjectId: largest.project_id,
      parts: others.map((row) => ({
        key: newProjectPartKey(),
        projectId: row.project_id,
        unit: "amount",
        value: amountText(size(row)),
      })),
    };
  }
  return { parts: [], restProjectId: rows[0]?.project_id ?? lineProjectId ?? null };
}

/** The shares as they are saved now, to tell an edit from the saved split. */
export function sharesKey(shares: readonly ProjectShare[] | null): string {
  if (shares == null) return "";
  return [...shares].map((share) => `${share.project_id}:${String(share.amount_minor)}`).sort().join("|");
}
