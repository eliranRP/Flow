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
    const selected = screen.getByRole("tab", { name: "הוצאות" });
    expect(selected).toHaveAttribute("aria-selected", "true");
    expectTarget(selected, 36);
    expectThemePaint(selected, "backgroundColor");
  });
});
