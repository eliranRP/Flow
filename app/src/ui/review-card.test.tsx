import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReviewCard } from "./review-card";

describe("ReviewCard", () => {
  it("shows no note for a missing project, mutes empty rows, hides VAT, and shows income project", () => {
    const onProject = vi.fn();
    render(
      <ReviewCard
        supplier="לקוח דוגמה"
        sourceLine="הכנסה · 01/09/2026"
        netAgorot={10_000n}
        currency="USD"
        vatLine={null}
        direction="income"
        onProject={onProject}
        onCategory={() => undefined}
      />,
    );
    expect(screen.queryByText(/חסר פרויקט/)).not.toBeInTheDocument();
    expect(screen.queryByText(/אין הצעה/)).not.toBeInTheDocument();
    expect(screen.queryByText(/לפני מע״מ|פטור ממע״מ/)).not.toBeInTheDocument();
    expect(screen.getByText(/הכנסה ·/)).toBeInTheDocument();
    const projectRow = screen.getByRole("button", { name: /פרויקט: לא נבחר/ });
    expect(projectRow.querySelector(".ui-row-title")).toHaveClass("ui-row-title-muted");
    expect(screen.getByRole("button", { name: /פרויקט:/ })).toBeInTheDocument();
  });

  it("prefixes expense amounts with a minus and leaves income unsigned", () => {
    const { rerender } = render(
      <ReviewCard
        supplier="Vendor"
        sourceLine="הוצאה · 01/09/2026"
        netAgorot={125_000n}
        direction="expense"
      />,
    );
    expect(screen.getByText("−₪1,250")).toBeInTheDocument();
    rerender(
      <ReviewCard
        supplier="Client"
        sourceLine="הכנסה · 01/09/2026"
        netAgorot={125_000n}
        direction="income"
      />,
    );
    expect(screen.getByText("₪1,250")).toBeInTheDocument();
    expect(screen.queryByText(/^−/)).not.toBeInTheDocument();
  });
});
