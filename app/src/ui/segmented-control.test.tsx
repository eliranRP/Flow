import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SegmentedControl } from "./segmented-control";
import { expectRtl, expectTarget, expectThemePaint } from "./test-support";

describe("SegmentedControl", () => {
  it("presses one segment and paints it in both themes", () => {
    expectRtl();
    render(
      <SegmentedControl
        label="בסיס"
        value="cash"
        onChange={() => undefined}
        options={[
          { value: "cash", label: "מזומן" },
          { value: "invoiced", label: "חשבוניות" },
        ]}
      />,
    );
    const selected = screen.getByRole("button", { name: "מזומן" });
    expect(selected).toHaveAttribute("aria-pressed", "true");
    expectTarget(selected);
    expectThemePaint(selected, "backgroundColor");
  });
});
