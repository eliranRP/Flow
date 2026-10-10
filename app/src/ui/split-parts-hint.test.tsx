import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SplitPartsHint } from "./split-parts-hint";

const text = (node: HTMLElement) =>
  [...node.querySelectorAll(".ui-hint-wrap-part")].map((part) =>
    part.textContent.replace(" · ", "").trim(),
  );

describe("SplitPartsHint (FLOW-432)", () => {
  it("names each part with its amount, then the whole line, then the date", () => {
    const { container } = render(
      <SplitPartsHint
        parts={[
          { name: "מים וביוב", amount: "$183.10" },
          { name: "חשמל", amount: "$171.76" },
        ]}
        total="$2,054.86"
        date="07/10"
      />,
    );
    expect(text(container)).toEqual([
      "מים וביוב $183.10",
      "חשמל $171.76",
      "מתוך $2,054.86",
      "07/10",
    ]);
    expect(container.querySelector(".ui-hint-wrap-3")).not.toBeNull();
  });

  it("names the first of three or more parts, then how many more", () => {
    const parts = [
      { name: "א", amount: "$3" },
      { name: "ב", amount: "$2" },
      { name: "ג", amount: "$1" },
    ];
    const { container } = render(<SplitPartsHint parts={parts} total="$10" />);
    expect(text(container)).toEqual(["א $3", "ועוד 2", "מתוך $10"]);
  });

  it("names a single part without its amount, which is the row's figure", () => {
    const { container } = render(
      <SplitPartsHint
        parts={[{ name: "הכנסות שכירות", amount: "$1,700" }]}
        total="$2,054.86"
        date="07/10"
      />,
    );
    expect(text(container)).toEqual([
      "הכנסות שכירות",
      "מתוך $2,054.86",
      "07/10",
    ]);
  });
});
