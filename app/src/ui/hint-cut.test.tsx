import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { cutPoints, cutText, fitCut, HintText } from "./hint-cut";

/** A monospace text: every grapheme is 10px wide. */
const mono = (text: string) => (end: number) => [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text.slice(0, end))].length * 10;

describe("hint cut (FLOW-172)", () => {
  it("drops the spaces and punctuation a cut ends in before its ellipsis", () => {
    expect(cutText("Quick ")).toBe("Quick…");
    expect(cutText("חשמל ותאורה, ")).toBe("חשמל ותאורה…");
    expect(cutText("Cedar St")).toBe("Cedar St…");
    expect(cutText("Unit 2 ($")).toBe("Unit 2 ($…");
  });

  it("cuts at the longest prefix that fits with the ellipsis, then trims it", () => {
    const text = "Quick Fix Plumbing";
    // 75px holds "Quick " (60) and the ellipsis (10); "Quick F" (70) and the ellipsis do not fit.
    expect(fitCut(text, 75, mono(text), 10)).toBe("Quick…");
    expect(fitCut(text, 80, mono(text), 10)).toBe("Quick F…");
    expect(fitCut(text, 180, mono(text), 10)).toBeNull();
    expect(fitCut(text, 5, mono(text), 10)).toBe("…");
  });

  it("never cuts inside a letter and its marks", () => {
    expect(cutPoints("שָׁלוֹם")).toEqual([3, 4, 6, 7]);
    const text = "שָׁלוֹם רב";
    expect(fitCut(text, 30, mono(text), 10)).toBe("שָׁל…");
  });

  it("keeps the whole text in the DOM, in its own direction, with no cut where it fits", () => {
    const { container } = render(<HintText text="Quick Fix Plumbing" dir="auto" />);
    const text = container.querySelector(".ui-hint-text");
    expect(text?.textContent).toBe("Quick Fix Plumbing");
    expect(text).toHaveAttribute("dir", "auto");
    expect(text).toHaveAttribute("data-clip-ok");
    expect(text).not.toHaveAttribute("data-cut");
  });
});
