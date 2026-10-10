import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SplitPartsHint } from "./split-parts-hint";

/** Each line of the hint, its whole parts joined by " · ". */
const lines = (node: HTMLElement) =>
  [...node.querySelectorAll(".ui-split-hint > *")].map((line) => line.textContent.replace(/\s+/g, " ").trim());

describe("SplitPartsHint (FLOW-432)", () => {
  it("names each part with its amount, then the whole line and the date on a line of their own", () => {
    const { container } = render(
      <SplitPartsHint parts={[{ name: "מים וביוב", amount: "$183.10" }, { name: "חשמל", amount: "$171.76" }]} total="$2,054.86" date="07/10" />,
    );
    expect(lines(container)).toEqual(["מים וביוב $183.10 · חשמל $171.76", "מתוך $2,054.86 · 07/10"]);
    // The date shares the מתוך line or is clipped with it; it never opens a line alone.
    expect(container.querySelector(".ui-hint-wrap-1")?.textContent).toContain("07/10");
  });

  it("keeps the first of three or more parts with how many more, on one line", () => {
    const parts = [{ name: "א", amount: "$3" }, { name: "ב", amount: "$2" }, { name: "ג", amount: "$1" }];
    const { container } = render(<SplitPartsHint parts={parts} total="$10" />);
    expect(lines(container)).toEqual(["א $3 · ועוד 2", "מתוך $10"]);
    expect(container.querySelector(".ui-split-hint-name")?.textContent).toBe("א");
  });

  it("names a single part without its amount, which is the row's figure", () => {
    const { container } = render(<SplitPartsHint parts={[{ name: "הכנסות שכירות", amount: "$1,700" }]} total="$2,054.86" date="07/10" />);
    expect(lines(container)).toEqual(["הכנסות שכירות", "מתוך $2,054.86 · 07/10"]);
  });
});
