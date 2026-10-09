import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { shekelsToAgorot } from "@flow/shared";
import { MoneyField, PercentField } from "./money-field";
import { expectRtl, expectTarget } from "./test-support";

function BudgetForm() {
  const [budget, setBudget] = useState("");
  const [saved, setSaved] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setSaved(shekelsToAgorot(budget).toString());
      }}
    >
      <MoneyField label="תקציב" value={budget} onValueChange={setBudget} />
      <button type="submit">שמירה</button>
      <output>{saved}</output>
    </form>
  );
}

describe("MoneyField", () => {
  it("lays the prefix beside a hidden copy of the shown digits, so separators keep its gap (FLOW-310)", () => {
    const { container } = render(<MoneyField label="סכום" value="1234567.89" prefix="$" onValueChange={() => undefined} />);
    const lead = container.querySelector(".ui-money-lead");
    expect(lead).toHaveAttribute("aria-hidden", "true");
    expect(lead?.querySelector(".ui-money-prefix")).toHaveTextContent("$");
    expect(lead?.querySelector(".ui-money-mirror")).toHaveTextContent("1,234,567.89");
    expect(screen.getByLabelText("סכום")).toHaveValue("1,234,567.89");
  });

  it("a message outside the field describes it, next to its own error (FLOW-325)", () => {
    render(
      <>
        <MoneyField label="סכום" value="1200" onValueChange={() => undefined} describedBy="row-msg" />
        <PercentField label="אחוז" value="30" onValueChange={() => undefined} id="pct" error="עד 100%" describedBy="row-msg" />
      </>,
    );
    expect(screen.getByLabelText("סכום")).toHaveAttribute("aria-describedby", "row-msg");
    expect(screen.getByLabelText("אחוז")).toHaveAttribute("aria-describedby", "pct-error row-msg");
  });

  it("puts ₪ before an LTR amount", () => {
    expectRtl();
    render(<MoneyField label="סכום" value="1200" onValueChange={() => undefined} />);
    const field = screen.getByLabelText("סכום");
    expect(field).toHaveAttribute("dir", "ltr");
    expect(field).toHaveAttribute("inputmode", "decimal");
    expect(field).toHaveAttribute("autocomplete", "off");
    expect(field.getAttribute("name") ?? "").toMatch(/^flow-amount-/);
    expect(field.getAttribute("name") ?? "").not.toMatch(/name|email|tel|phone|contact/i);
    expectTarget(field);
    expect(screen.getByText("₪")).toBeInTheDocument();
    expect(screen.queryByText("לפני מע״מ")).not.toBeInTheDocument();
  });

  it("uses a dollar prefix when one is passed", () => {
    render(<MoneyField label="סכום" value="100" prefix="$" onValueChange={() => undefined} />);
    expect(screen.getByText("$")).toBeInTheDocument();
    expect(screen.queryByText("₪")).not.toBeInTheDocument();
  });

  it("groups thousands as the digits are typed and still submits them", () => {
    render(<BudgetForm />);
    const field = screen.getByLabelText("תקציב");
    fireEvent.change(field, { target: { value: "12000" } });
    expect(field).toHaveValue("12,000");
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(screen.getByText("1200000")).toBeInTheDocument();
  });
});
