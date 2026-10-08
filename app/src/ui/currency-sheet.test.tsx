import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { CurrencySheet, CURRENCY_SHEET_NOTE, currencyChoiceLabel } from "./currency-sheet";

function renderSheet(props: Partial<Parameters<typeof CurrencySheet>[0]> = {}) {
  const onPick = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <MemoryRouter>
      <CurrencySheet open value="ILS" saving={null} onPick={onPick} onOpenChange={onOpenChange} {...props} />
    </MemoryRouter>,
  );
  return { onPick, onOpenChange };
}

describe("CurrencySheet", () => {
  it("marks the stored currency and says nothing is converted", () => {
    renderSheet({ value: "USD" });
    expect(screen.getByRole("radio", { name: "$ דולר" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "₪ שקל" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(CURRENCY_SHEET_NOTE)).toBeInTheDocument();
  });

  it("applies another currency on tap and only closes on the current one", () => {
    const { onPick, onOpenChange } = renderSheet();
    fireEvent.click(screen.getByRole("radio", { name: "₪ שקל" }));
    expect(onPick).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("radio", { name: "$ דולר" }));
    expect(onPick).toHaveBeenCalledWith("USD");
  });

  it("spins the saving row and holds the other one", () => {
    const { onPick } = renderSheet({ saving: "USD" });
    expect(screen.getByRole("radio", { name: "$ דולר" })).toHaveAttribute("aria-busy", "true");
    const other = screen.getByRole("radio", { name: "₪ שקל" });
    expect(other).toBeDisabled();
    fireEvent.click(other);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("labels a known currency and falls back to the code", () => {
    expect(currencyChoiceLabel("USD")).toBe("$ דולר");
    expect(currencyChoiceLabel("EUR")).toBe("EUR");
  });
});
