import { formatAmountText } from "@flow/shared";

/**
 * FLOW-327 / FLOW-701. The words on the review card for Jev's reason (decision 0134) and the
 * anomaly flag (decision 0131). Pure: the card draws each `{ num }` part in its own `bdi.ui-num`.
 */
export type CopyPart = string | { num: string };

/** The parts as one plain string, for tests and accessible names. */
export function copyText(parts: readonly CopyPart[]): string {
  return parts.map((part) => (typeof part === "string" ? part : part.num)).join("");
}

export type JevReasonKind = "same_as_last" | "usual_for_party" | "new_party" | "model_only";

export type JevReasonInfo = {
  reason: JevReasonKind;
  partyFilings: number;
  matchingFilings: number;
};

export function isJevReasonKind(value: unknown): value is JevReasonKind {
  return value === "same_as_last" || value === "usual_for_party" || value === "new_party" || value === "model_only";
}

/** ספק on an expense, לקוח on income. */
export function partyWord(direction: "income" | "expense" | undefined): string {
  return direction === "income" ? "לקוח" : "ספק";
}

/** The one reason line under the card's field rows. `hasParty` is false when the line names no party. */
export function jevReasonText(
  info: JevReasonInfo,
  direction: "income" | "expense" | undefined,
  hasParty = true,
): CopyPart[] {
  switch (info.reason) {
    case "same_as_last":
      return ["כמו בפעם הקודמת"];
    case "usual_for_party":
      return [
        "כמו ב־",
        { num: String(info.matchingFilings) },
        " מתוך ",
        { num: String(info.partyFilings) },
        " הפעמים האחרונות",
      ];
    case "new_party":
      return hasParty ? [`${partyWord(direction)} חדש · בלי היסטוריה`] : ["בלי היסטוריה קודמת"];
    case "model_only":
      return ["הערכה של Jev בלבד"];
  }
}

export type ReviewFlagKind = "duplicate" | "amount_spike" | "new_party_large";

/** One row of `review_anomalies`. `jev_score` is null when Jev is off or did not score it. */
export type ReviewFlag = {
  transaction_id: string;
  kind: ReviewFlagKind;
  jev_score: number | null;
  other_doc_date?: string | null;
  typical_amount_minor?: number | null;
  ratio?: number | null;
};

/** A Jev score at or above this is loud, the same as the "medium from 0.7" band in 0126. */
export const REVIEW_FLAG_LOUD = 0.7;

const KIND_ORDER: Record<ReviewFlagKind, number> = { duplicate: 0, amount_spike: 1, new_party_large: 2 };

export type ReviewFlagView =
  | { tone: "loud"; kind: ReviewFlagKind; title: CopyPart[]; hint?: CopyPart[] }
  | { tone: "quiet"; kind: ReviewFlagKind; line: CopyPart[] };

export function flagTone(score: number | null | undefined): "loud" | "quiet" {
  return typeof score === "number" && Number.isFinite(score) && score >= REVIEW_FLAG_LOUD ? "loud" : "quiet";
}

/** dd/mm from an ISO date. */
function dayMonth(iso: string | null | undefined): string | null {
  if (iso == null) return null;
  const [, month, day] = iso.slice(0, 10).split("-");
  if (!month || !day) return null;
  return `${day}/${month}`;
}

function ratioText(ratio: number | null | undefined): string | null {
  if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio <= 0) return null;
  return String(Math.round(ratio * 10) / 10);
}

/**
 * At most one flag per card: loud before quiet, then duplicate, amount_spike, new_party_large.
 * A flag never blocks אישור and never changes the line (0131). Jev only sets how loud it is.
 */
export function reviewFlagView(
  flags: readonly ReviewFlag[] | null | undefined,
  context: { direction?: "income" | "expense"; currency?: string } = {},
): ReviewFlagView | null {
  if (flags == null || flags.length === 0) return null;
  const sorted = [...flags].sort((left, right) => {
    const tone = (flagTone(left.jev_score) === "loud" ? 0 : 1) - (flagTone(right.jev_score) === "loud" ? 0 : 1);
    if (tone !== 0) return tone;
    return KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
  });
  const flag = sorted[0];
  if (!flag) return null;
  const party = partyWord(context.direction);
  const tone = flagTone(flag.jev_score);
  switch (flag.kind) {
    case "duplicate": {
      const day = dayMonth(flag.other_doc_date);
      const when: CopyPart[] = day == null ? [] : [" ב־", { num: day }];
      if (tone === "loud") {
        return { tone, kind: flag.kind, title: ["ייתכן שזה כפל"], hint: [`אותו ${party} ואותו סכום`, ...when] };
      }
      return { tone, kind: flag.kind, line: ["שורה באותו סכום", ...when] };
    }
    case "amount_spike": {
      const ratio = ratioText(flag.ratio);
      const times: CopyPart[] = ratio == null ? ["גבוה מהרגיל"] : ["פי ", { num: ratio }, " מהרגיל"];
      if (tone === "loud") {
        const typical = typeof flag.typical_amount_minor === "number" && Number.isFinite(flag.typical_amount_minor)
          ? formatAmountText(BigInt(Math.abs(Math.trunc(flag.typical_amount_minor))), context.currency ?? "ILS")
          : null;
        // With no ratio the title already says it is high: the hint is the usual amount, or nothing.
        const hint: CopyPart[] = ratio == null
          ? typical == null ? [] : ["בדרך כלל ", { num: typical }]
          : typical == null ? times : [...times, " · בדרך כלל ", { num: typical }];
        return {
          tone,
          kind: flag.kind,
          title: ["סכום גבוה מהרגיל"],
          ...(hint.length === 0 ? {} : { hint }),
        };
      }
      return { tone, kind: flag.kind, line: [...times, ` ל${party}`] };
    }
    case "new_party_large":
      if (tone === "loud") {
        return { tone, kind: flag.kind, title: [`${party} חדש בסכום גבוה`], hint: ["בין ", { num: "10%" }, " השורות הגבוהות בשנה"] };
      }
      return { tone, kind: flag.kind, line: [`${party} חדש בסכום גבוה`] };
  }
}

/** The words a screen reader hears before the flag. */
export const REVIEW_FLAG_PREFIX = "לבדיקה:";
