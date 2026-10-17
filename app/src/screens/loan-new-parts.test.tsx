import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LoanCurrencySwitch, LoanPaymentCard, LoanPickRow, LoanSectionTitle } from "./loan-new-parts";

describe("loan-new-parts", () => {
  it("titles a block in the board's caption", () => {
    render(<LoanSectionTitle>מלווה ופרויקט</LoanSectionTitle>);
    expect(screen.getByText("מלווה ופרויקט")).toHaveClass("ui-loan-section-title");
  });

  it("draws a pick row as a dialog trigger named by its label and value, and opens on tap", () => {
    const onOpen = vi.fn();
    render(<LoanPickRow label="פרויקט" value="ללא פרויקט" empty onOpen={onOpen} />);
    const row = screen.getByRole("button", { name: "פרויקט ללא פרויקט" });
    expect(row).toHaveAttribute("aria-haspopup", "dialog");
    expect(row.querySelector(".ui-loan-pick-value")).toHaveAttribute("data-empty", "true");
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("switches the currency by its radio, and the selected one is checked", () => {
    const onChange = vi.fn();
    render(<LoanCurrencySwitch value="USD" disabled={false} onChange={onChange} />);
    expect(screen.getByRole("radio", { name: "$" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "₪" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "₪" }));
    expect(onChange).toHaveBeenCalledWith("ILS");
  });

  it("shows the payment card's rows, and שינוי toggles the override under them", () => {
    const onToggle = vi.fn();
    render(
      <LoanPaymentCard
        label="תשלום חודשי"
        total="$1,837.76"
        split="קרן וריבית $1,477.76 · מסים וביטוח $360.00"
        until="תשלום אחרון 10/2056"
        expanded
        controls="override"
        disabled={false}
        onToggle={onToggle}
      >
        <div id="override">override field</div>
      </LoanPaymentCard>,
    );
    expect(screen.getByText("תשלום חודשי")).toBeInTheDocument();
    expect(screen.getByText("$1,837.76")).toBeInTheDocument();
    expect(screen.getByText("קרן וריבית $1,477.76 · מסים וביטוח $360.00")).toBeInTheDocument();
    expect(screen.getByText("תשלום אחרון 10/2056")).toBeInTheDocument();
    const change = screen.getByRole("button", { name: "שינוי" });
    expect(change).toHaveAttribute("aria-expanded", "true");
    expect(change).toHaveAttribute("aria-controls", "override");
    expect(screen.getByText("override field")).toBeInTheDocument();
    fireEvent.click(change);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("hides שינוי for a demand loan, which has no payment to override", () => {
    render(
      <LoanPaymentCard label="תשלום חודשי" total="—" split="לפי דרישה: בלי לוח תשלומים קבוע" until="" expanded={false} controls="x" disabled={false} changeable={false} onToggle={() => undefined} />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "שינוי" })).toBeNull();
  });

  it("marks a caution line in the warning tone", () => {
    render(
      <LoanPaymentCard label="תשלום חודשי" total="$1" split="" until="" note={{ content: "התשלום האחרון כפול, $2", caution: true }} expanded={false} controls="x" disabled={false} onToggle={() => undefined} />,
    );
    expect(screen.getByText("התשלום האחרון כפול, $2")).toHaveClass("ui-loan-caution");
  });
});
