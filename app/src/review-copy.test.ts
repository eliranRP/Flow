// @vitest-environment node
import { describe, expect, it } from "vitest";
import { copyText, flagTone, jevReasonText, REVIEW_FLAG_LOUD, reviewFlagView, spikePercentText, type ReviewFlag } from "./review-copy";

const info = (reason: "same_as_last" | "usual_for_party" | "new_party" | "model_only", partyFilings = 5, matchingFilings = 3) => ({
  reason,
  partyFilings,
  matchingFilings,
});

describe("jevReasonText (FLOW-327, decision 0134)", () => {
  it("says each reason in Hebrew, with ספק on an expense and לקוח on income", () => {
    expect(copyText(jevReasonText(info("same_as_last"), "expense"))).toBe("כמו בפעם הקודמת");
    expect(copyText(jevReasonText(info("usual_for_party", 5, 3), "expense"))).toBe("כמו ב־3 מתוך 5 הפעמים האחרונות");
    expect(copyText(jevReasonText(info("new_party"), "expense"))).toBe("ספק חדש · בלי היסטוריה");
    expect(copyText(jevReasonText(info("new_party"), "income"))).toBe("לקוח חדש · בלי היסטוריה");
    expect(copyText(jevReasonText(info("new_party"), "expense", false))).toBe("בלי היסטוריה קודמת");
    expect(copyText(jevReasonText(info("model_only"), "income"))).toBe("הערכה של Jev בלבד");
  });

  it("keeps each count its own number part, for a bdi", () => {
    expect(jevReasonText(info("usual_for_party", 4, 2), "expense").filter((part) => typeof part !== "string")).toEqual([{ num: "2" }, { num: "4" }]);
  });
});

function flag(kind: ReviewFlag["kind"], score: number | null, extra: Partial<ReviewFlag> = {}): ReviewFlag {
  return { transaction_id: "t1", kind, jev_score: score, ...extra };
}

describe("reviewFlagView (FLOW-327, decision 0131)", () => {
  it("is loud from 0.7, quiet below it and when unscored", () => {
    expect(REVIEW_FLAG_LOUD).toBe(0.7);
    expect(flagTone(0.69)).toBe("quiet");
    expect(flagTone(0.7)).toBe("loud");
    expect(flagTone(1)).toBe("loud");
    expect(flagTone(null)).toBe("quiet");
    expect(flagTone(undefined)).toBe("quiet");
    expect(flagTone(Number.NaN)).toBe("quiet");
  });

  it("shows no flag for none", () => {
    expect(reviewFlagView([])).toBeNull();
    expect(reviewFlagView(null)).toBeNull();
  });

  it("writes each kind loud and quiet", () => {
    const dupLoud = reviewFlagView([flag("duplicate", 0.8, { other_doc_date: "2026-10-03" })]);
    expect(dupLoud?.tone).toBe("loud");
    if (dupLoud?.tone !== "loud") throw new Error("loud");
    expect(copyText(dupLoud.title)).toBe("ייתכן שזה כפל");
    expect(copyText(dupLoud.hint ?? [])).toBe("אותו ספק ואותו סכום ב־03/10");
    const dupQuiet = reviewFlagView([flag("duplicate", 0.2, { other_doc_date: "2026-10-03" })], { direction: "income" });
    if (dupQuiet?.tone !== "quiet") throw new Error("quiet");
    expect(copyText(dupQuiet.line)).toBe("שורה באותו סכום ב־03/10");

    // 2026-10-09 option A: the spike sits by the amount. The view keeps the loud title for a spike with no ratio; beside a pill the card draws no row.
    const spikeLoud = reviewFlagView([flag("amount_spike", 0.7, { ratio: 4.2, typical_amount_minor: 120_000 })]);
    if (spikeLoud?.tone !== "loud") throw new Error("loud");
    expect(copyText(spikeLoud.title)).toBe("סכום גבוה מהרגיל");
    expect(spikeLoud.hint).toBeUndefined();
    expect(spikeLoud.spike?.pill).toBe("↑ 320%");
    expect(spikeLoud.spike?.spoken).toBe("לבדיקה: גבוה ב־320% מהרגיל לספק");
    expect(copyText(spikeLoud.spike?.usual ?? [])).toBe("בדרך כלל ₪1,200");
    // A quiet spike with a ratio has no line of its own: no "פי X מהרגיל" anywhere.
    const spikeQuiet = reviewFlagView([flag("amount_spike", 0.69, { ratio: 3 })], { direction: "income" });
    if (spikeQuiet?.tone !== "quiet") throw new Error("quiet");
    expect(spikeQuiet.line).toEqual([]);
    expect(spikeQuiet.spike).toEqual({ pill: "↑ 200%", spoken: "גבוה ב־200% מהרגיל ללקוח", usual: null });
    const spikeExpense = reviewFlagView([flag("amount_spike", null, { ratio: 3.4, typical_amount_minor: 250_000 })]);
    if (spikeExpense?.tone !== "quiet") throw new Error("quiet");
    expect(spikeExpense.line).toEqual([]);
    expect(spikeExpense.spike?.spoken).toBe("גבוה ב־240% מהרגיל לספק");
    expect(spikeExpense.spike?.usual).toEqual(["בדרך כלל ", { num: "₪2,500" }]);

    const newLoud = reviewFlagView([flag("new_party_large", 0.95)], { direction: "income" });
    if (newLoud?.tone !== "loud") throw new Error("loud");
    expect(copyText(newLoud.title)).toBe("לקוח חדש בסכום גבוה");
    expect(copyText(newLoud.hint ?? [])).toBe("בין 10% השורות הגבוהות בשנה");
    const newQuiet = reviewFlagView([flag("new_party_large", null)]);
    if (newQuiet?.tone !== "quiet") throw new Error("quiet");
    expect(copyText(newQuiet.line)).toBe("ספק חדש בסכום גבוה");
  });

  it("picks one flag: loud before quiet, then duplicate, amount_spike, new_party_large", () => {
    expect(reviewFlagView([flag("new_party_large", 0.9), flag("duplicate", 0.1)])?.kind).toBe("new_party_large");
    expect(reviewFlagView([flag("new_party_large", 0.9), flag("amount_spike", 0.8), flag("duplicate", 0.75)])?.kind).toBe("duplicate");
    expect(reviewFlagView([flag("new_party_large", null), flag("amount_spike", null)])?.kind).toBe("amount_spike");
  });

  it("leaves out a missing date or ratio rather than inventing one", () => {
    const dup = reviewFlagView([flag("duplicate", null)]);
    if (dup?.tone !== "quiet") throw new Error("quiet");
    expect(copyText(dup.line)).toBe("שורה באותו סכום");
    const spike = reviewFlagView([flag("amount_spike", 0.9)]);
    if (spike?.tone !== "loud") throw new Error("loud");
    // The title already says it is high: no ratio and no usual amount leaves no pill and no hint.
    expect(spike.hint).toBeUndefined();
    expect(spike.spike).toEqual({ pill: null, spoken: null, usual: null });
    const usual = reviewFlagView([flag("amount_spike", 0.9, { typical_amount_minor: 120_000 })]);
    if (usual?.tone !== "loud") throw new Error("loud");
    expect(usual.spike?.pill).toBeNull();
    expect(copyText(usual.spike?.usual ?? [])).toBe("בדרך כלל ₪1,200");
    // A quiet spike with no ratio keeps its line, with no number, since there is no pill to carry it.
    const quiet = reviewFlagView([flag("amount_spike", 0.2, { typical_amount_minor: 120_000 })], { direction: "income" });
    if (quiet?.tone !== "quiet") throw new Error("quiet");
    expect(copyText(quiet.line)).toBe("גבוה מהרגיל ללקוח");
    expect(copyText(quiet.spike?.usual ?? [])).toBe("בדרך כלל ₪1,200");
  });

  it("rounds the spike to whole percent above the usual amount, and drops it when not above", () => {
    expect(spikePercentText(3.4)).toBe("240%");
    expect(spikePercentText(1.236)).toBe("24%");
    expect(spikePercentText(12.5)).toBe("1,150%");
    expect(spikePercentText(1.004)).toBeNull();
    expect(spikePercentText(0.5)).toBeNull();
    expect(spikePercentText(null)).toBeNull();
    expect(spikePercentText(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("leaves other kinds as they were, with no spike", () => {
    expect(reviewFlagView([flag("duplicate", 0.9)])?.spike).toBeUndefined();
    expect(reviewFlagView([flag("new_party_large", 0.1)])?.spike).toBeUndefined();
  });
});
