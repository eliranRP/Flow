import { formatShare, type AllocatedPart, type SplitMethod } from "../split-math";
import { splitDraftKey } from "../split-drafts";

/** Pure helpers and the session draft for the split screen (split-screen.tsx). */

export function evenSentence(parts: AllocatedPart[], total: bigint): string {
  const first = parts[0];
  if (!first) return "";
  if (parts.length === 1) return `${formatShare(first.agorot)} לפרויקט אחד`;
  const same = parts.every((part) => part.agorot === first.agorot);
  if (same) return `${formatShare(first.agorot)} לכל אחד מ־${String(parts.length)} פרויקטים`;
  return `${formatShare(total)} מתחלק שווה בין ${String(parts.length)} פרויקטים`;
}

export function percentWords(bp: number): string {
  const tenths = Math.round(Math.abs(bp) / 10);
  const whole = Math.trunc(tenths / 10);
  const frac = tenths % 10;
  return frac === 0 ? String(whole) : `${String(whole)}.${String(frac)}`;
}

export function sameBasis(left: Record<string, number>, right: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if ((left[key] ?? 0) !== (right[key] ?? 0)) return false;
  }
  return true;
}

export type SplitDraft = {
  method: SplitMethod | null;
  manual: Record<string, string>;
  chosen: string[];
  oneProject: string;
};

export function readSplitDraft(id: string): SplitDraft | null {
  if (id === "" || typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(splitDraftKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      method?: unknown;
      manual?: SplitDraft["manual"];
      chosen?: SplitDraft["chosen"];
      oneProject?: string;
    };
    const method = parsed.method;
    if (method != null && method !== "equal" && method !== "chosen" && method !== "income" && method !== "manual" && method !== "one") return null;
    const known = method === "equal" || method === "chosen" || method === "income" || method === "manual" || method === "one" ? method : null;
    return {
      method: known,
      manual: parsed.manual ?? {},
      chosen: parsed.chosen ?? [],
      oneProject: parsed.oneProject ?? "",
    };
  } catch {
    return null;
  }
}

export function writeSplitDraft(id: string, draft: SplitDraft) {
  if (id === "" || typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(splitDraftKey(id), JSON.stringify(draft));
}

export function clearSplitDraft(id: string) {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(splitDraftKey(id));
}
