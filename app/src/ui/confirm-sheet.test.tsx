import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConfirmSheet } from "./confirm-sheet";
import { expectRtl, expectTarget, expectThemePaint } from "./test-support";

describe("ConfirmSheet", () => {
  it("confirms a delete on bad-tint, not a solid red fill", () => {
    expectRtl();
    render(
      <ConfirmSheet
        open
        onOpenChange={() => undefined}
        title="למחוק את ההוצאה?"
        item="כוח אדם"
        consequence="אפשר לבטל."
        confirmLabel="מחיקה"
        destructive
        onConfirm={() => undefined}
      />,
    );
    const confirm = screen.getByRole("button", { name: "מחיקה" });
    expect(confirm).toHaveClass("ui-btn-danger-tint");
    expectTarget(confirm);
    expectTarget(screen.getByRole("button", { name: "ביטול" }));
    expectThemePaint(confirm, "backgroundColor");
  });
});
