import { describe, expect, it } from "vitest";
import { chargeMark, chargesTitle, earlierCharges, partyChangeView, shortMonth } from "./party-charges";
import { cheaperCharges, mailboxCharges, rentCharges, steadyCharges } from "./ui/related-charges.sample";

describe("partyChangeView (FLOW-431)", () => {
  it("an expense up is bad news, with the usual amount", () => {
    expect(partyChangeView(mailboxCharges)).toMatchObject({ percent: "92%", arrow: "▲", hurts: true, usual: "$11.99", change: "עלה ב־92%" });
  });
  it("an expense down is good news", () => {
    expect(partyChangeView(cheaperCharges)).toMatchObject({ arrow: "▼", hurts: false, percent: "42%", change: "ירד ב־42%" });
  });
  it("income down is bad news", () => {
    expect(partyChangeView(rentCharges)).toMatchObject({ arrow: "▼", hurts: true, words: "ירידה של 20% לעומת הרגיל, ₪5,000" });
  });
  it("the usual amount reads as such", () => {
    expect(partyChangeView(steadyCharges)).toMatchObject({ percent: null, arrow: null, hurts: false, change: "כרגיל" });
  });
  it("no usual amount, no change line", () => {
    expect(partyChangeView({ ...mailboxCharges, typical_amount_minor: null, change_percent: null })).toBeNull();
    expect(partyChangeView({ ...mailboxCharges, party: null })).toBeNull();
    expect(partyChangeView(undefined)).toBeNull();
  });
});

describe("earlierCharges", () => {
  it("leaves out this line", () => {
    const earlier = earlierCharges(mailboxCharges);
    expect(earlier.some((c) => c.id === mailboxCharges.transaction_id)).toBe(false);
    expect(earlier.length).toBe(mailboxCharges.charges.length - 1);
  });
});

describe("labels", () => {
  it("short months fit six bars", () => {
    expect(["2026-10", "2026-05", "2026-06", "2026-03"].map(shortMonth)).toEqual(["אוק׳", "מאי", "יוני", "מרץ"]);
  });
  it("income says תקבולים", () => {
    expect(chargesTitle(rentCharges)).toBe("תקבולים קודמים");
    expect(chargesTitle(mailboxCharges)).toBe("חיובים קודמים");
  });
});

describe("chargeMark (FLOW-366)", () => {
  it("marks a charge only from 20% either way, and only the bad way in red", () => {
    expect(chargeMark(12_700n, 10_000n, false)).toMatchObject({ arrow: "▲", percent: "27%", hurts: true });
    expect(chargeMark(12_700n, 10_000n, true)).toMatchObject({ arrow: "▲", percent: "27%", hurts: false });
    // A 26.5% rise reads as 27%, the board's rounding, not 26% by truncation.
    expect(chargeMark(124_000n, 98_000n, false)).toMatchObject({ arrow: "▲", percent: "27%" });
    expect(chargeMark(8_000n, 10_000n, false)).toMatchObject({ arrow: "▼", hurts: false });
    expect(chargeMark(10_900n, 10_000n, false)).toBeNull();
    expect(chargeMark(10_000n, 0n, false)).toBeNull();
  });
});
