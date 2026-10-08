import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SegmentedControl } from "./segmented-control";
import { expectRtl, expectTarget, expectThemePaint } from "./test-support";

describe("SegmentedControl", () => {
  it("presses one segment and paints it in both themes", () => {
    expectRtl();
    render(
      <SegmentedControl
        label="תצוגה"
        value="expenses"
        onChange={() => undefined}
        options={[
          { value: "expenses", label: "הוצאות" },
          { value: "income", label: "הכנסות" },
        ]}
      />,
    );
    const selected = screen.getByRole("radio", { name: "הוצאות" });
    expect(selected).toHaveAttribute("aria-checked", "true");
    expectTarget(selected);
    expectThemePaint(selected, "backgroundColor");
  });

  it("keeps one tab stop when no segment is selected (a custom period)", () => {
    render(
      <SegmentedControl<string>
        label="תקופה"
        value="custom"
        onChange={() => undefined}
        options={[
          { value: "month", label: "חודש" },
          { value: "year", label: "שנה" },
        ]}
      />,
    );
    const radios = screen.getAllByRole("radio");
    expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "false"]);
    expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1]);
  });
});
