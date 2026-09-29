import { formatIls } from "@flow/shared";

/** A project the split can use. Missing status counts as active. */
export type SplitProject = {
  id: string;
  name: string;
  incomeAgorot?: bigint;
  status?: "active" | "finished";
};

export type SplitMethod = "equal" | "chosen" | "income" | "manual";

export type AllocatedPart = {
  id: string;
  bp: number;
  agorot: bigint;
};

/**
 * Basis points from a typed percent. "33.33" is 3333, "100" is 10000.
 * Integer hundredths, so the value round-trips without a float.
 */
export function percentToBp(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === ".") return 0;
  const [whole = "", frac = ""] = trimmed.split(".");
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac)) return 0;
  const hundredths = Number(whole || "0") * 100 + Number((frac + "00").slice(0, 2));
  return Number.isFinite(hundredths) ? hundredths : 0;
}

/** One decimal. 3330 is "33.3" and 10000 is "100". */
export function bpToPercent(bp: number): string {
  const tenths = Math.round(bp / 10);
  const whole = Math.trunc(tenths / 10);
  const frac = Math.abs(tenths % 10);
  if (frac === 0) return String(whole);
  return `${String(whole)}.${String(frac)}`;
}

/**
 * Manual fields keep one decimal, so basis points become tenths that still sum to 100.0%.
 * The largest fractional remainder gets the extra tenth.
 */
export function basisToPercents(ids: string[], basis: Record<string, number>): Record<string, string> {
  const rows = ids.map((id) => {
    const exact = (basis[id] ?? 0) / 10;
    const floor = Math.floor(exact + 1e-9);
    return { id, floor, rest: exact - floor };
  });
  let spare = 1000 - rows.reduce((sum, row) => sum + row.floor, 0);
  const ranked = [...rows].sort((a, b) => b.rest - a.rest || ids.indexOf(a.id) - ids.indexOf(b.id));
  const extra = new Set<string>();
  for (const row of ranked) {
    if (spare <= 0) break;
    extra.add(row.id);
    spare -= 1;
  }
  const out: Record<string, string> = {};
  for (const row of rows) {
    const tenths = row.floor + (extra.has(row.id) ? 1 : 0);
    if (tenths <= 0) continue;
    out[row.id] = tenths % 10 === 0 ? String(tenths / 10) : `${String(Math.trunc(tenths / 10))}.${String(tenths % 10)}`;
  }
  return out;
}

export function activeProjects(projects: SplitProject[]): SplitProject[] {
  return projects.filter((project) => project.status !== "finished");
}

/** Equal basis points. The last id carries the remainder so the total is 10000. */
export function evenBasis(ids: string[]): Record<string, number> {
  if (ids.length === 0) return {};
  const base = Math.floor(10000 / ids.length);
  let used = 0;
  const shares: Record<string, number> = {};
  ids.forEach((id, index) => {
    const bp = index === ids.length - 1 ? 10000 - used : base;
    shares[id] = bp;
    used += bp;
  });
  return shares;
}

/** Income weights. No income at all falls back to an even split. */
export function incomeBasis(projects: SplitProject[]): Record<string, number> {
  const total = projects.reduce((sum, project) => sum + (project.incomeAgorot ?? 0n), 0n);
  if (total <= 0n) return evenBasis(projects.map((project) => project.id));
  let used = 0;
  const shares: Record<string, number> = {};
  projects.forEach((project, index) => {
    if (index === projects.length - 1) {
      shares[project.id] = 10000 - used;
      return;
    }
    const bp = Number(((project.incomeAgorot ?? 0n) * 10000n) / total);
    shares[project.id] = bp;
    used += bp;
  });
  return shares;
}

/**
 * Shekel parts for a signed or absolute amount.
 * Each part is amount * bp / 10000, truncating toward zero.
 * Leftover agorot moves to the last share only when the basis points sum to 10000.
 * An incomplete or over-full split shows each row's own share, with no remainder.
 */
export function allocate(amount: bigint, ordered: Array<{ id: string; bp: number }>): AllocatedPart[] {
  const rows = ordered.filter((row) => row.bp > 0);
  let assigned = 0n;
  let basis = 0;
  const parts: AllocatedPart[] = rows.map((row) => {
    const agorot = (amount * BigInt(row.bp)) / 10000n;
    assigned += agorot;
    basis += row.bp;
    return { id: row.id, bp: row.bp, agorot };
  });
  const last = parts[parts.length - 1];
  if (last && basis === 10000 && assigned !== amount) {
    parts[parts.length - 1] = { ...last, agorot: last.agorot + (amount - assigned) };
  }
  return parts;
}

/**
 * `save_split` adds leftover agorot to the first JSON element.
 * The screen puts that leftover on the last project, so the payload is reversed
 * and the stored agorot match the rows the owner just confirmed.
 */
export function sharesForSave(parts: Array<{ id: string; bp: number }>): Array<{ project_id: string; share_bp: number }> {
  return [...parts].reverse().map((part) => ({ project_id: part.id, share_bp: part.bp }));
}

export function splitIsValid(parts: AllocatedPart[]): boolean {
  if (parts.length === 0) return false;
  const sum = parts.reduce((total, part) => total + part.bp, 0);
  return sum === 10000 && parts.every((part) => part.bp >= 1 && part.bp <= 10000);
}

export type SummaryKind =
  | { kind: "one"; agorot: bigint }
  | { kind: "each"; agorot: bigint; count: number }
  | { kind: "income"; count: number }
  | { kind: "mixed"; groups: Array<{ agorot: bigint; count: number }> };

/** One sentence. Equal amounts say "לכל אחד". Income that differs does not pretend the shekels match. */
export function summaryKind(method: SplitMethod, parts: AllocatedPart[]): SummaryKind | null {
  const first = parts[0];
  if (!first) return null;
  if (parts.length === 1) return { kind: "one", agorot: first.agorot };
  const equal = parts.every((part) => part.agorot === first.agorot);
  if (equal) return { kind: "each", agorot: first.agorot, count: parts.length };
  if (method === "income") return { kind: "income", count: parts.length };
  const groups: Array<{ agorot: bigint; count: number }> = [];
  for (const part of parts) {
    const found = groups.find((group) => group.agorot === part.agorot);
    if (found) found.count += 1;
    else groups.push({ agorot: part.agorot, count: 1 });
  }
  return { kind: "mixed", groups };
}

/** Whole shekels when the part has no agorot, so ₪500 stays ₪500. */
export function formatShare(agorot: bigint): string {
  return formatIls(agorot, { agorot: true });
}
