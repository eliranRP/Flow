import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { PercentField } from "./money-field";

function Field({ start = "" }: { start?: string }) {
  const [share, setShare] = useState(start);
  return <PercentField label="אחוז, חולון" value={share} onValueChange={setShare} />;
}

describe("PercentField", () => {
  it("keeps digits, at most two decimal places, and an empty value", () => {
    const { unmount } = render(<Field start="9" />);
    const input = screen.getByRole("textbox", { name: "אחוז, חולון" });
    fireEvent.change(input, { target: { value: "12.349x" } });
    expect(input).toHaveValue("12.3");
    fireEvent.change(input, { target: { value: "8" } });
    expect(input).toHaveValue("8");
    fireEvent.change(input, { target: { value: "" } });
    expect(input).toHaveValue("");
    fireEvent.change(input, { target: { value: "100" } });
    expect(input).toHaveValue("100");
    expect(input).toHaveAttribute("inputmode", "decimal");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input.getAttribute("name") ?? "").toMatch(/^split-pct-/);
    expect(input.id).toMatch(/^split-pct-/);
    expect(input).toHaveAttribute("enterkeyhint", "next");
    unmount();

    render(<Field />);
    expect(screen.getByRole("textbox", { name: "אחוז, חולון" })).toHaveValue("");
  });

  it("keeps three decimals for a loan rate", () => {
    function Rate() {
      const [rate, setRate] = useState("");
      return <PercentField label="ריבית שנתית" value={rate} decimals={3} onValueChange={setRate} />;
    }
    render(<Rate />);
    const input = screen.getByRole("textbox", { name: "ריבית שנתית" });
    fireEvent.change(input, { target: { value: "6.1259" } });
    expect(input).toHaveValue("6.125");
  });
});
