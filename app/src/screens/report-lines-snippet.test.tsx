import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { pickCut, SearchSnippet, snippetCuts, snippetText } from "./report-lines-snippet";

/** Each cut's drawn text, in the order the rule tries them. */
const shown = (description: string, query: string) => snippetCuts(description, query).map((cut) => snippetText(description, cut));

describe("the drill-down's description snippet (FLOW-170)", () => {
  it("tries the whole description first, then two words before the match, then the match's own word", () => {
    expect(shown("Water heater replacement, unit 2", "unit")).toEqual([
      "Water heater replacement, unit 2",
      "…heater replacement, unit 2",
      "…unit 2",
    ]);
    // The whole text is tried first: a cut is drawn only when the whole text does not show the word.
    expect(shown("Annual renewal", "renewal")).toEqual(["Annual renewal", "…renewal"]);
    expect(shown("החלפת לוח החשמל הראשי בקומת הכניסה, יחידה 4", "יחידה")).toEqual([
      "החלפת לוח החשמל הראשי בקומת הכניסה, יחידה 4",
      "…בקומת הכניסה, יחידה 4",
      "…יחידה 4",
    ]);
  });

  it("finds the word as the search matched it: a figure without its comma or sign, gershayim typed as \"", () => {
    expect(shown("Quarterly service visit for the boiler room, refund −$1,388.00 to tenant", "-$1,388")[1]).toBe("…room, refund −$1,388.00 to tenant");
    expect(shown("חשבונית מספר 4471 עבור עבודות אינסטלציה, חברת אבג בע״מ", 'בע"מ')[1]).toBe("…חברת אבג בע״מ");
    // A match inside a word counts from that word's start.
    expect(shown("Quarterly service visit for the shared community laundry", "unit")[1]).toBe("…the shared community laundry");
  });

  it("orders the cuts by the matches' places, whatever the order of the words", () => {
    const description = "Quarterly service visit for the boiler room, parts and labour, unit 2";
    expect(shown(description, "unit boiler")).toEqual([
      description,
      "…for the boiler room, parts and labour, unit 2",
      "…boiler room, parts and labour, unit 2",
      "…and labour, unit 2",
      "…unit 2",
    ]);
  });

  it("cuts a description with no spaces at its punctuation, or at the match", () => {
    const slashes = "INV/2026/10/0042/BUILDING-B/WATERHEATER/REPLACEMENT/UNIT2/FINAL";
    expect(shown(slashes, "unit2").slice(1)).toEqual(["…WATERHEATER/REPLACEMENT/UNIT2/FINAL", "…UNIT2/FINAL"]);
    const bare = "ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPheaterXYZ";
    expect(shown(bare, "heater").slice(1)).toEqual(["…heaterXYZ"]);
  });

  it("picks the first cut that shows every matched word, else the one that shows the most", () => {
    expect(pickCut([1], 1)).toBe(0);
    expect(pickCut([0, 1], 1)).toBe(1);
    expect(pickCut([1, 2, 2], 2)).toBe(1);
    // No cut shows both: the most, the earliest of a tie.
    expect(pickCut([0, 1, 1, 0], 2)).toBe(1);
    expect(pickCut([0, 0], 2)).toBe(0);
  });

  it("draws the whole description when there is no layout to measure", () => {
    render(<SearchSnippet text="Water heater replacement, unit 2" query="unit" />);
    expect(screen.getByText("Water heater replacement, unit 2")).toBeInTheDocument();
  });
});
