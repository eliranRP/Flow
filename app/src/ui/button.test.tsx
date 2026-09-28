import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";
import { expectRtl, expectTarget, expectThemePaint } from "./test-support";

describe("Button", () => {
  it("draws primary, secondary, pill, and danger at a 44px target in both themes", () => {
    expectRtl();
    render(
      <>
        <Button variant="primary">אישור</Button>
        <Button variant="secondary">שינוי</Button>
        <Button variant="pill">סימון</Button>
        <Button variant="danger">מחיקה</Button>
      </>,
    );
    for (const name of ["אישור", "שינוי", "סימון", "מחיקה"]) {
      expectTarget(screen.getByRole("button", { name }));
    }
    expect(screen.getByRole("button", { name: "אישור" })).toHaveClass("btn-pri");
    expect(screen.getByRole("button", { name: "מחיקה" })).toHaveClass("ui-btn-danger");
    expectThemePaint(screen.getByRole("button", { name: "אישור" }), "backgroundColor");
    expectThemePaint(screen.getByRole("button", { name: "מחיקה" }), "backgroundColor");
  });
});
