/** A project the split can use. Missing status counts as active. */
export type SplitProject = {
  id: string;
  name: string;
  incomeAgorot?: bigint;
  status?: "active" | "finished";
};

export type AllocatedPart = {
  id: string;
  bp: number;
  agorot: bigint;
};

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

