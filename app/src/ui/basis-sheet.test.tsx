import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { BasisSheet, BASIS_SHEET_NOTE, basisChoiceLabel } from "./basis-sheet";

function renderSheet(props: Partial<Parameters<typeof BasisSheet>[0]> = {}) {
  const onPick = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <MemoryRouter>
      <BasisSheet open value="cash" saving={null} onPick={onPick} onOpenChange={onOpenChange} {...props} />
    </MemoryRouter>,
  );
  return { onPick, onOpenChange };
}

describe("BasisSheet (FLOW-103)", () => {
  it("marks the stored basis and says what counts by it", () => {
    renderSheet({ value: "invoiced" });
    expect(screen.getByRole("radio", { name: /^תאריך חשבונית/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /^תאריך תשלום/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("כשהכסף יצא או נכנס בבנק")).toBeInTheDocument();
    expect(screen.getByText(BASIS_SHEET_NOTE)).toBeInTheDocument();
  });

  it("applies the other basis on tap and only closes on the current one", () => {
    const { onPick, onOpenChange } = renderSheet();
    fireEvent.click(screen.getByRole("radio", { name: /^תאריך תשלום/ }));
    expect(onPick).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("radio", { name: /^תאריך חשבונית/ }));
    expect(onPick).toHaveBeenCalledWith("invoiced", expect.any(Function));
  });

  it("spins the saving row and holds the other one", () => {
    const { onPick } = renderSheet({ saving: "invoiced" });
    expect(screen.getByRole("radio", { name: /^תאריך חשבונית/ })).toHaveAttribute("aria-busy", "true");
    const other = screen.getByRole("radio", { name: /^תאריך תשלום/ });
    expect(other).toBeDisabled();
    fireEvent.click(other);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("names each basis for the Settings row", () => {
    expect(basisChoiceLabel("cash")).toBe("תאריך תשלום");
    expect(basisChoiceLabel("invoiced")).toBe("תאריך חשבונית");
  });
});
