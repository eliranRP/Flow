import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SelectField } from "./select-field";
import { expectRtl, expectTarget, expectThemePaint } from "./test-support";

describe("SelectField", () => {
  it("is a 44px labelled select in both themes", () => {
    expectRtl();
    render(
      <SelectField
        label="קטגוריה"
        options={[
          { value: "materials", label: "חומרים" },
          { value: "labor", label: "עבודה" },
        ]}
      />,
    );
    const field = screen.getByLabelText("קטגוריה");
    expectTarget(field);
    expectThemePaint(field, "backgroundColor");
    expect(screen.getByRole("option", { name: "חומרים" })).toBeInTheDocument();
  });
});
