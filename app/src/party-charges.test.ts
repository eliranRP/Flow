import { describe, expect, it } from "vitest";
import { chargesTitle, partyChangeView, shortMonth } from "./party-charges";
import { cheaperCharges, mailboxCharges, rentCharges, steadyCharges } from "./ui/related-charges.sample";

describe("partyChangeView (FLOW-431)", () => {
  it("an expense up is bad news, with the usual amount on the chip", () => {
    expect(partyChangeView(mailboxCharges)).toMatchObject({ percent: "92%", arrow: "▲", tone: "bad", usual: "$11.99", label: "▲ 92% לעומת הרגיל $11.99" });
  });
  it("an expense down is good news", () => {
    expect(partyChangeView(cheaperCharges)).toMatchObject({ arrow: "▼", tone: "good", percent: "42%" });
  });
  it("income down is bad news", () => {
    expect(partyChangeView(rentCharges)).toMatchObject({ arrow: "▼", tone: "bad", words: "ירידה של 20% לעומת הרגיל, ₪5,000" });
  });
  it("the usual amount reads as such", () => {
    expect(partyChangeView(steadyCharges)).toMatchObject({ percent: null, tone: "flat", label: "כמו הרגיל $11.99" });
  });
  it("no usual amount, no chip", () => {
    expect(partyChangeView({ ...mailboxCharges, typical_amount_minor: null, change_percent: null })).toBeNull();
    expect(partyChangeView({ ...mailboxCharges, party: null })).toBeNull();
    expect(partyChangeView(undefined)).toBeNull();
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
