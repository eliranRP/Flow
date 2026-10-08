import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

  it("offers the safer path as a quiet link under ביטול (FLOW-405)", () => {
    const instead = vi.fn();
    render(
      <ConfirmSheet
        open
        onOpenChange={() => undefined}
        title="למחוק את הקטגוריה?"
        item="חומרים · 4 תנועות"
        consequence="התנועות יישארו בלי קטגוריה ויחזרו ללשונית לאישור."
        detail="1 מהן מפוצלת, והפיצול שלה יימחק."
        confirmLabel="מחיקה"
        destructive
        alternative={{ label: "להעביר את התנועות לקטגוריה אחרת במקום", onClick: instead }}
        onConfirm={() => undefined}
      />,
    );
    expect(screen.getByText("1 מהן מפוצלת, והפיצול שלה יימחק.")).toBeInTheDocument();
    const link = screen.getByRole("button", { name: "להעביר את התנועות לקטגוריה אחרת במקום" });
    expect(link).toHaveClass("ui-text-link-quiet");
    fireEvent.click(link);
    expect(instead).toHaveBeenCalledOnce();
  });
});
