import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Stepper } from "./stepper";

function Harness({ start = 1, disabled = false }: { start?: number; disabled?: boolean }) {
  const [value, setValue] = useState(start);
  return <Stepper label="מספר תשלומים" value={value} min={1} max={3} hint="01/06/2026" disabled={disabled} onChange={setValue} />;
}

describe("Stepper (FLOW-106)", () => {
  it("steps between its ends and disables the end it reached", () => {
    render(<Harness />);
    const value = screen.getByRole("spinbutton", { name: "מספר תשלומים" });
    expect(screen.getByRole("button", { name: "פחות, מספר תשלומים" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "יותר, מספר תשלומים" }));
    fireEvent.click(screen.getByRole("button", { name: "יותר, מספר תשלומים" }));
    expect(value).toHaveAttribute("aria-valuenow", "3");
    expect(screen.getByRole("button", { name: "יותר, מספר תשלומים" })).toBeDisabled();
    fireEvent.keyDown(value, { key: "Home" });
    expect(value).toHaveAttribute("aria-valuenow", "1");
    fireEvent.keyDown(value, { key: "ArrowUp" });
    expect(value).toHaveAttribute("aria-valuenow", "2");
    expect(value).toHaveAccessibleDescription("01/06/2026");
  });

  it("does nothing while disabled", () => {
    render(<Harness disabled />);
    expect(screen.getByRole("button", { name: "יותר, מספר תשלומים" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("spinbutton"), { key: "ArrowUp" });
    expect(screen.getByRole("spinbutton")).toHaveAttribute("aria-valuenow", "1");
  });
});
