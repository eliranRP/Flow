import { parseShekelInput } from "@flow/shared";
import { z } from "zod";
import { LINE_SPLIT_DRAFT_PREFIX } from "./split-drafts";

/**
 * FLOW-325 (decision 0123). The parts editor's state and the payload it sends to
 * `save_line_split`. The cents come from the server's preview (`p_preview`), never from a
 * client copy of the rounding; this module only shapes, checks and reads the parts.
 */

export type PartUnit = "percent" | "amount";

/** One part as the editor holds it. `value` is what the owner typed. */
export type PartDraft = {
  key: string;
  categoryId: string;
  /** null keeps the line's project (פרויקט השורה). */
  projectId: string | null;
  unit: PartUnit;
  value: string;
};

/** The rest row. null keeps the line's own category or project. */
export type RestDraft = { categoryId: string | null; projectId: string | null };

export type PayloadPart =
  | { category_id: string; project_id: string | null; amount_minor: number }
  | { category_id: string; project_id: string | null; percent: number }
  | { rest: true; category_id?: string; project_id?: string | null };

/** A part the server returns, from `get_line_split` or a preview. */
export type ServerPart = {
  category_id: string;
  category_name?: string | null;
  project_id: string | null;
  project_name?: string | null;
  amount_minor: bigint;
  /** null for an amount, the rest, or a part restored by undo. */
  percent: number | null;
  rest: boolean;
};

export type LineSplitRead = {
  transactionId: string;
  currency: string;
  lineMinor: bigint;
  parts: ServerPart[];
  /** False when a bank re-sync changed the line so the parts no longer sum to it. */
  partsMatch: boolean;
};

const minorSchema = z.union([z.number().int(), z.string().regex(/^-?\d+$/)]).transform((value) => BigInt(value));

const serverPartSchema = z.object({
  category_id: z.string(),
  category_name: z.string().nullable().optional(),
  project_id: z.string().nullable().optional().transform((value) => value ?? null),
  project_name: z.string().nullable().optional(),
  amount_minor: minorSchema,
  // A part restored by undo carries neither marker.
  percent: z.union([z.number(), z.string()]).nullable().optional().transform((value) => (value == null ? null : Number(value))),
  rest: z.boolean().nullable().optional().transform((value) => value === true),
});

const readSchema = z.object({
  transaction_id: z.string(),
  currency: z.string().optional(),
  line_minor: minorSchema,
  parts: z.array(serverPartSchema),
  parts_match: z.boolean().optional(),
});

/** `get_line_split`. null when the line is not readable (removed, another company). */
export function parseLineSplit(data: unknown): LineSplitRead | null {
  if (data == null) return null;
  const parsed = readSchema.parse(data);
  return {
    transactionId: parsed.transaction_id,
    currency: parsed.currency ?? "ILS",
    lineMinor: parsed.line_minor,
    parts: parsed.parts,
    partsMatch: parsed.parts_match !== false,
  };
}

/** `save_line_split(..., p_preview => true)`: the parts a save would store. */
export function parsePreview(data: unknown): ServerPart[] {
  return z.array(serverPartSchema).parse(data ?? []);
}

/** 0.01–100 with at most two decimals, else null. The field already drops a third decimal. */
export function percentOf(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return null;
  const value = Number(text);
  if (!(value > 0) || value > 100) return null;
  return value;
}

/** Whole minor units above zero, else null. */
export function amountOf(raw: string): bigint | null {
  const text = raw.trim();
  if (text === "" || text === ".") return null;
  try {
    const minor = parseShekelInput(text);
    return minor > 0n ? minor : null;
  } catch {
    return null;
  }
}

/** Minor units to what the amount field holds: "1440", "1440.5" → "1440.50". */
export function amountText(minor: bigint): string {
  const abs = minor < 0n ? -minor : minor;
  const whole = abs / 100n;
  const cents = abs % 100n;
  return cents === 0n ? String(whole) : `${String(whole)}.${String(cents).padStart(2, "0")}`;
}

/** A percent for display: up to 2 decimals, no trailing zeros. */
export function percentText(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

/** What share of the line an amount is, for the hint under an amount field. */
export function shareOfLine(minor: bigint, lineMinor: bigint): number {
  if (lineMinor === 0n) return 0;
  return Number((minor * 1_000_000n) / lineMinor) / 10_000;
}

export type LineContext = {
  lineMinor: bigint;
  lineCategoryId: string | null;
  lineProjectId: string | null;
  /** True for a category of the other kind than the line (a reversal), except the line's own. */
  isReversal: (categoryId: string) => boolean;
};

/** The request, in the order shown: the parts, then the rest. */
export function buildPayload(parts: readonly PartDraft[], rest: RestDraft): PayloadPart[] | null {
  const out: PayloadPart[] = [];
  for (const part of parts) {
    if (part.categoryId === "") return null;
    if (part.unit === "percent") {
      const percent = percentOf(part.value);
      if (percent == null) return null;
      out.push({ category_id: part.categoryId, project_id: part.projectId, percent });
    } else {
      const minor = amountOf(part.value);
      if (minor == null) return null;
      out.push({ category_id: part.categoryId, project_id: part.projectId, amount_minor: Number(minor) });
    }
  }
  const restPart: PayloadPart = { rest: true };
  if (rest.categoryId != null) restPart.category_id = rest.categoryId;
  if (rest.projectId != null) restPart.project_id = rest.projectId;
  out.push(restPart);
  return out;
}

/** A client check that the server would also make, or one it cannot make (an empty field). */
export type LocalIssue =
  | "incomplete"
  | "percent over"
  | "too few parts"
  | "a reversal part needs a project"
  | "same category and project twice"
  | "parts exceed the line";

export type LocalCheck = {
  /** The first issue for the footer, or null. */
  form: LocalIssue | null;
  /** Issues per part key. */
  parts: Record<string, LocalIssue>;
  /** The rest row repeats a part's category and project. */
  restDuplicate: boolean;
  /** How far the parts go over the line, in minor units (0 when they don't). */
  overMinor: bigint;
  /**
   * What the rest takes once every value is filled in: the line less the amounts and the
   * percents' rounded total (0123). Exact for the rest; the cents per percent part still come
   * from the preview. null while a value is missing.
   */
  restMinor: bigint | null;
};

function pairKey(categoryId: string, projectId: string | null, ctx: LineContext): string {
  // A part with no project keeps the line's project, so both name the same pair.
  return `${categoryId}|${projectId ?? ctx.lineProjectId ?? ""}`;
}

export function checkParts(parts: readonly PartDraft[], rest: RestDraft, ctx: LineContext): LocalCheck {
  const issues: Record<string, LocalIssue> = {};
  const seen = new Map<string, string>();
  let form: LocalIssue | null = null;
  let amountTotal = 0n;
  let percentHundredths = 0n;
  const note = (key: string, issue: LocalIssue) => {
    issues[key] ??= issue;
    form ??= issue;
  };
  if (parts.length === 0) form = "too few parts";
  for (const part of parts) {
    if (part.categoryId !== "") {
      const pair = pairKey(part.categoryId, part.projectId, ctx);
      const earlier = seen.get(pair);
      if (earlier != null) {
        note(part.key, "same category and project twice");
        issues[earlier] ??= "same category and project twice";
      } else seen.set(pair, part.key);
      if (part.projectId == null && part.categoryId !== ctx.lineCategoryId && ctx.isReversal(part.categoryId)) {
        note(part.key, "a reversal part needs a project");
      }
    }
    if (part.unit === "percent") {
      const raw = part.value.trim();
      const value = Number(raw);
      if (raw !== "" && Number.isFinite(value) && value > 100) note(part.key, "percent over");
      const percent = percentOf(part.value);
      if (percent == null) note(part.key, "incomplete");
      else percentHundredths += BigInt(Math.round(percent * 100));
    } else {
      const minor = amountOf(part.value);
      if (minor == null) note(part.key, "incomplete");
      else amountTotal += minor;
    }
    if (part.categoryId === "") note(part.key, "incomplete");
  }
  const restCategory = rest.categoryId ?? ctx.lineCategoryId;
  const restDuplicate = restCategory != null && seen.has(pairKey(restCategory, rest.projectId, ctx));
  if (restDuplicate) form ??= "same category and project twice";
  // The percents' rounded total is round(line × Σ% / 100), the whole line at 100% (0123).
  // Only the total is computed here, to say how far the parts go over; the cents per part
  // always come from the server's preview.
  const percentMinor = percentHundredths === 10_000n
    ? ctx.lineMinor
    : (ctx.lineMinor * percentHundredths * 2n + 10_000n) / 20_000n;
  const used = amountTotal + percentMinor;
  const overMinor = used > ctx.lineMinor ? used - ctx.lineMinor : 0n;
  if (overMinor > 0n) form = "parts exceed the line";
  const complete = parts.every((part) => part.categoryId !== "" && (part.unit === "percent" ? percentOf(part.value) != null : amountOf(part.value) != null));
  return { form, parts: issues, restDuplicate, overMinor, restMinor: complete ? ctx.lineMinor - used : null };
}

let keySeed = 0;
/**
 * A stable key for a new part row. Random, so a draft restored from sessionStorage after a
 * reload (whose rows already hold keys) never meets a repeat.
 */
export function newPartKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `part-${crypto.randomUUID()}`;
  keySeed += 1;
  return `part-${String(Date.now())}-${String(keySeed)}-${Math.random().toString(36).slice(2)}`;
}

/** A percent the field can hold as is: at most two decimals (the server keeps four). */
function twoDecimals(value: number): boolean {
  return Math.round(value * 100) / 100 === value;
}

/** The cents a percent takes of the line, rounded half up: the fallback when there is no preview. */
export function percentMinorOf(percent: number, lineMinor: bigint): bigint {
  const hundredths = BigInt(Math.round(percent * 100));
  if (hundredths === 10_000n) return lineMinor;
  return (lineMinor * hundredths * 2n + 10_000n) / 20_000n;
}

/**
 * Turns a saved split back into editor rows (plan §3). A part saved by percent reopens in %,
 * an amount in ₪. A percent with more than two decimals (the server keeps four) reopens in ₪
 * with its saved cents, so an untouched part is never re-sent rounded. The part marked rest becomes the rest row; a split restored by undo has no
 * marker, so the part on the line's own category with no project becomes the rest.
 */
export function draftFromRead(
  read: LineSplitRead | null | undefined,
  lineCategoryId: string | null,
): { parts: PartDraft[]; rest: RestDraft } {
  const empty = { parts: [] as PartDraft[], rest: { categoryId: null, projectId: null } as RestDraft };
  if (!read || read.parts.length === 0) return empty;
  let restIndex = read.parts.findIndex((part) => part.rest);
  if (restIndex < 0) restIndex = read.parts.findIndex((part) => part.category_id === lineCategoryId && part.project_id == null);
  const restPart = restIndex >= 0 ? read.parts[restIndex] : undefined;
  const rest: RestDraft = restPart
    ? { categoryId: restPart.category_id === lineCategoryId ? null : restPart.category_id, projectId: restPart.project_id }
    : { categoryId: null, projectId: null };
  const parts = read.parts.flatMap((part, index): PartDraft[] => {
    if (index === restIndex) return [];
    const byPercent = part.percent != null && twoDecimals(part.percent);
    return [{
      key: `saved-${String(index)}`,
      categoryId: part.category_id,
      projectId: part.project_id,
      unit: byPercent ? "percent" : "amount",
      value: byPercent && part.percent != null ? percentText(part.percent) : amountText(part.amount_minor),
    }];
  });
  return { parts, rest };
}

/** The saved split as amounts, for undo: the app has no undo RPC for a line split. */
export function amountsPayload(read: LineSplitRead | null | undefined): PayloadPart[] {
  if (!read) return [];
  return read.parts.map((part) => ({
    category_id: part.category_id,
    project_id: part.project_id,
    amount_minor: Number(part.amount_minor),
  }));
}

export type Resolved = {
  /** Cents per part key, from the preview. */
  parts: Record<string, bigint>;
  /** What the rest takes; 0 when the server dropped it. */
  rest: bigint;
};

/**
 * Matches a preview to the rows. Pairs are unique (the server refuses a repeat), so a part is
 * found by its category and project; the rest by its marker.
 */
export function resolvePreview(preview: readonly ServerPart[], parts: readonly PartDraft[]): Resolved {
  const out: Record<string, bigint> = {};
  for (const part of parts) {
    const hit = preview.find((row) => !row.rest && row.category_id === part.categoryId && row.project_id === part.projectId);
    if (hit) out[part.key] = hit.amount_minor;
  }
  const rest = preview.find((row) => row.rest)?.amount_minor ?? 0n;
  return { parts: out, rest };
}

/** The editor's draft in sessionStorage, so a reload or a pop keeps what was typed (plan §7). */

export function lineSplitDraftKey(id: string): string {
  return `${LINE_SPLIT_DRAFT_PREFIX}${id}`;
}

export function readLineDraft(id: string): { parts: PartDraft[]; rest: RestDraft } | null {
  try {
    if (id === "" || typeof sessionStorage === "undefined") return null;
    const raw = sessionStorage.getItem(lineSplitDraftKey(id));
    if (!raw) return null;
    const parsed = z.object({
      parts: z.array(z.object({
        key: z.string(),
        categoryId: z.string(),
        projectId: z.string().nullable(),
        unit: z.enum(["percent", "amount"]),
        value: z.string(),
      })),
      rest: z.object({ categoryId: z.string().nullable(), projectId: z.string().nullable() }),
    }).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeLineDraft(id: string, draft: { parts: PartDraft[]; rest: RestDraft }): void {
  try {
    if (id === "" || typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(lineSplitDraftKey(id), JSON.stringify(draft));
  } catch {
    // Storage blocked: the draft lives only on screen.
  }
}

export function clearLineDraft(id: string): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.removeItem(lineSplitDraftKey(id));
  } catch {
    // Nothing to clear.
  }
}
