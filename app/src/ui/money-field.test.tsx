import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { shekelsToAgorot } from "@flow/shared";
import { MoneyField } from "./money-field";
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
  it("puts ₪ before an LTR amount", () => {
    expectRtl();
    render(<MoneyField label="סכום" value="1200" onValueChange={() => undefined} />);
    const field = screen.getByLabelText("סכום");
    expect(field).toHaveAttribute("dir", "ltr");
    expect(field).toHaveAttribute("inputmode", "decimal");
    expectTarget(field);
    expect(screen.getByText("₪")).toBeInTheDocument();
    expect(screen.queryByText("לפני מע״מ")).not.toBeInTheDocument();
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
