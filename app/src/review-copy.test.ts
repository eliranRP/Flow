import { describe, expect, it } from "vitest";
import { copyText, flagTone, jevReasonText, REVIEW_FLAG_LOUD, reviewFlagView, type ReviewFlag } from "./review-copy";

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
    expect(copyText(dupLoud.hint)).toBe("אותו ספק ואותו סכום ב־03/10");
    const dupQuiet = reviewFlagView([flag("duplicate", 0.2, { other_doc_date: "2026-10-03" })], { direction: "income" });
    if (dupQuiet?.tone !== "quiet") throw new Error("quiet");
    expect(copyText(dupQuiet.line)).toBe("שורה באותו סכום ב־03/10");

    const spikeLoud = reviewFlagView([flag("amount_spike", 0.7, { ratio: 4.2, typical_amount_minor: 120_000 })]);
    if (spikeLoud?.tone !== "loud") throw new Error("loud");
    expect(copyText(spikeLoud.title)).toBe("סכום גבוה מהרגיל");
    expect(copyText(spikeLoud.hint)).toBe("פי 4.2 מהרגיל · בדרך כלל ₪1,200");
    const spikeQuiet = reviewFlagView([flag("amount_spike", 0.69, { ratio: 3 })], { direction: "income" });
    if (spikeQuiet?.tone !== "quiet") throw new Error("quiet");
    expect(copyText(spikeQuiet.line)).toBe("פי 3 מהרגיל ללקוח");
    const spikeExpense = reviewFlagView([flag("amount_spike", null, { ratio: 3 })]);
    if (spikeExpense?.tone !== "quiet") throw new Error("quiet");
    expect(copyText(spikeExpense.line)).toBe("פי 3 מהרגיל לספק");

    const newLoud = reviewFlagView([flag("new_party_large", 0.95)], { direction: "income" });
    if (newLoud?.tone !== "loud") throw new Error("loud");
    expect(copyText(newLoud.title)).toBe("לקוח חדש בסכום גבוה");
    expect(copyText(newLoud.hint)).toBe("בין 10% השורות הגבוהות בשנה");
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
    expect(copyText(spike.hint)).toBe("גבוה מהרגיל");
  });
});
