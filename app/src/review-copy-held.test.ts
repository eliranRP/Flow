// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  copyText,
  REVIEW_HELD_HINT,
  REVIEW_HELD_REASON_BANK,
  REVIEW_HELD_REASON_SUMIT,
  reviewHeldView,
  type ReviewHeldRow,
} from "./review-copy";

// FLOW-1166 part 2c: the words on a closed_month_change card (the owner's wording of 2026-11-11).

const bankLine: ReviewHeldRow = {
  source: "mercury",
  amount_net: -120_000n,
  vat_agorot: 0n,
  currency: "USD",
  doc_date: "2026-03-14",
  line_status: "posted",
};

const sumitLine: ReviewHeldRow = {
  source: "sumit",
  amount_net: -100_000n,
  vat_agorot: -18_000n,
  currency: "ILS",
  doc_date: "2026-02-03",
  line_status: "posted",
};

function details(row: ReviewHeldRow): string[] {
  return reviewHeldView(row).details.map(copyText);
}

describe("reviewHeldView (FLOW-1166)", () => {
  it("names the bank or SUMIT in the reason, by the held change's provider, and always gives the hint", () => {
    const bank = reviewHeldView({ ...bankLine, held: { kind: "void", provider: "mercury" } });
    expect(bank.reason).toBe("שינוי מהבנק ממתין: התקופה סגורה בספרים.");
    expect(bank.hint).toBe("כדי לקבל את השינוי, הזיזו אחורה את תאריך הסגירה. הרענון הבא יכניס אותו.");
    expect(reviewHeldView({ ...sumitLine, held: { kind: "remove", provider: "sumit" } }).reason)
      .toBe("שינוי מ־SUMIT ממתין: התקופה סגורה בספרים.");
    // The provider of the change wins over the line's source.
    expect(reviewHeldView({ ...bankLine, held: { kind: "remove", provider: "sumit" } }).reason).toBe(REVIEW_HELD_REASON_SUMIT);
  });

  it("says the new amount in the held currency, formatted as the card's figure", () => {
    const held = { kind: "update", amount_minor: 135_050, currency: "USD", doc_date: "2026-03-14", line_status: "posted", provider: "mercury" };
    expect(details({ ...bankLine, held })).toEqual(["סכום חדש: $1,350.50"]);
    expect(reviewHeldView({ ...bankLine, held }).details[0]).toEqual(["סכום חדש: ", { num: "$1,350.50" }]);
    // A shekel line: the new gross against the stored net and VAT.
    expect(details({ ...sumitLine, held: { kind: "update", amount_minor: 120_000, currency: "ILS", doc_date: "2026-02-03", provider: "sumit" } }))
      .toEqual(["סכום חדש: ₪1,200"]);
  });

  it("leaves out the amount and the date when they did not change", () => {
    expect(details({ ...bankLine, held: { kind: "update", amount_minor: 120_000, currency: "USD", doc_date: "2026-03-14", line_status: "posted", provider: "mercury" } }))
      .toEqual([]);
    expect(details({ ...sumitLine, held: { kind: "update", amount_minor: 118_000, currency: "ILS", doc_date: "2026-02-03", provider: "sumit" } }))
      .toEqual([]);
  });

  it("says a new amount when only the currency changed", () => {
    expect(details({ ...bankLine, held: { kind: "update", amount_minor: 120_000, currency: "EUR", doc_date: "2026-03-14", provider: "mercury" } }))
      .toEqual(["סכום חדש: EUR 1,200"]);
  });

  it("says the new date as dd/mm/yyyy, after the amount", () => {
    expect(details({ ...bankLine, held: { kind: "update", amount_minor: 99_900, currency: "USD", doc_date: "2026-04-02", provider: "mercury" } }))
      .toEqual(["סכום חדש: $999", "תאריך חדש: 02/04/2026"]);
    expect(reviewHeldView({ ...bankLine, held: { kind: "update", amount_minor: 120_000, currency: "USD", doc_date: "2026-04-02" } }).details)
      .toEqual([["תאריך חדש: ", { num: "02/04/2026" }]]);
  });

  it("says a pending line became posted", () => {
    expect(details({ ...bankLine, line_status: "pending", held: { kind: "update", amount_minor: 120_000, currency: "USD", doc_date: "2026-03-14", line_status: "posted", provider: "mercury" } }))
      .toEqual(["השורה עברה לסופית."]);
    // A posted line that stays posted says nothing about its status.
    expect(details({ ...bankLine, held: { kind: "update", amount_minor: 120_000, currency: "USD", doc_date: "2026-03-14", line_status: "posted" } }))
      .toEqual([]);
  });

  it("says the bank dropped the line, or the document is gone from SUMIT", () => {
    expect(details({ ...bankLine, held: { kind: "void", provider: "mercury" } })).toEqual(["הבנק ביטל את השורה."]);
    expect(details({ ...bankLine, held: { kind: "remove", provider: "mercury" } })).toEqual(["הבנק ביטל את השורה."]);
    expect(details({ ...sumitLine, held: { kind: "remove", provider: "sumit" } })).toEqual(["המסמך נמחק ב־SUMIT."]);
    expect(details({ ...sumitLine, held: { kind: "void", provider: "sumit" } })).toEqual(["המסמך נמחק ב־SUMIT."]);
  });

  it("shows the reason and the hint with no details when held is missing or of an unknown kind", () => {
    for (const held of [undefined, null, { kind: "merge", provider: "mercury" }]) {
      const view = reviewHeldView({ ...bankLine, held });
      expect(view.reason).toBe(REVIEW_HELD_REASON_BANK);
      expect(view.hint).toBe(REVIEW_HELD_HINT);
      expect(view.details).toEqual([]);
    }
    // No provider anywhere: the line's source decides.
    expect(reviewHeldView({ ...sumitLine, held: undefined }).reason).toBe(REVIEW_HELD_REASON_SUMIT);
  });

  it("skips an update field that is missing or odd, never throwing", () => {
    expect(details({ ...bankLine, held: { kind: "update", amount_minor: null, currency: null, doc_date: null, provider: "mercury" } })).toEqual([]);
    expect(details({ ...bankLine, held: { kind: "update", amount_minor: 1.5, doc_date: "not a date", provider: "mercury" } })).toEqual([]);
  });
});
