import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { paceSheetCopy } from "./pace";
import { ChoiceSheet, type ChoiceSheetCopy } from "./choice-sheet";
import { BASIS_COPY, BASIS_SHEET_SUBTITLE, CURRENCY_COPY } from "./company-choices";

/** Renders a choice sheet open. `setSaving` changes the save in flight, as a parent would. */
function renderSheet<T extends string>(copy: ChoiceSheetCopy<T>, value: string, saving: T | null = null) {
  const onPick = vi.fn();
  const onOpenChange = vi.fn();
  const view = (inFlight: T | null) => (
    <MemoryRouter>
      <ChoiceSheet copy={copy} open value={value} saving={inFlight} onPick={onPick} onOpenChange={onOpenChange} />
    </MemoryRouter>
  );
  const { rerender } = render(view(saving));
  return { onPick, onOpenChange, setSaving: (next: T | null) => { rerender(view(next)); } };
}

describe("ChoiceSheet", () => {
  it("draws no divider between the rows and a filled disc for the chosen one", () => {
    // The sheet's rows are the bare list (no row lines); the chosen disc is solid, not a ring with a dot.
    render(
      <MemoryRouter>
        <ChoiceSheet copy={CURRENCY_COPY} open value="USD" saving={null} onPick={vi.fn()} onOpenChange={vi.fn()} />
      </MemoryRouter>,
    );
    const rows = document.querySelectorAll(".ui-choice-sheet .ui-radio-row");
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) expect(row.className).toContain("ui-radio-row");
    const on = screen.getByRole("radio", { name: "דולר · $" });
    expect(on.closest(".ui-choice-sheet")).not.toBeNull();
    // The disc is the visual circle inside the row: solid when chosen, the other rows are not on.
    expect(on.querySelector(".ui-radio")).toHaveAttribute("data-on", "true");
    expect(screen.getByRole("radio", { name: "שקל · ₪" }).querySelector(".ui-radio")).toHaveAttribute("data-on", "false");
    const css = readFileSync(resolve(__dirname, "css/04-banners-lists.css"), "utf8");
    expect(css).toMatch(/\.ui-choice-sheet \.ui-radio-row \{\s*border-bottom: 0;\s*\}/);
    expect(css).toMatch(/\.ui-choice-sheet \.ui-radio\[data-on="true"\] \{\s*font-size: 0;\s*\}/);
  });

  it("marks the stored currency and shows its description", () => {
    renderSheet(CURRENCY_COPY, "USD");
    expect(screen.getByRole("radio", { name: "דולר · $" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "שקל · ₪" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("שורות בשקל מומרות לפי שער היום")).toBeInTheDocument();
  });

  it("applies another choice on tap and only closes on the current one", () => {
    const { onPick, onOpenChange } = renderSheet(CURRENCY_COPY, "ILS");
    fireEvent.click(screen.getByRole("radio", { name: "שקל · ₪" }));
    expect(onPick).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("radio", { name: "דולר · $" }));
    expect(onPick).toHaveBeenCalledWith("USD", expect.any(Function));
  });

  it("spins the saving row and holds the other rows", () => {
    const { onPick } = renderSheet(CURRENCY_COPY, "ILS", "USD");
    expect(screen.getByRole("radio", { name: "דולר · $" })).toHaveAttribute("aria-busy", "true");
    const other = screen.getByRole("radio", { name: "שקל · ₪" });
    expect(other).toBeDisabled();
    fireEvent.click(other);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("waits for the save on Escape and Back, then closes once (0075)", async () => {
    const { onOpenChange, setSaving } = renderSheet(CURRENCY_COPY, "ILS", "USD");
    fireEvent.keyDown(document, { key: "Escape" });
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
      await Promise.resolve();
    });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "שקל · ₪" })).toHaveAttribute("aria-checked", "false");
    setSaving(null);
    await waitFor(() => { expect(onOpenChange).toHaveBeenCalledWith(false); });
    await act(async () => { await Promise.resolve(); });
    expect(onOpenChange).toHaveBeenCalledTimes(1);
  });

  it("closes once when a dismiss and the success close both land during the save", async () => {
    const { onPick, onOpenChange, setSaving } = renderSheet(CURRENCY_COPY, "ILS");
    fireEvent.click(screen.getByRole("radio", { name: "דולר · $" }));
    const close = onPick.mock.calls[0]?.[1] as () => void;
    setSaving("USD");
    fireEvent.keyDown(document, { key: "Escape" });
    await act(async () => { await Promise.resolve(); });
    act(() => { close(); });
    await act(async () => { await Promise.resolve(); });
    expect(onOpenChange).not.toHaveBeenCalled();
    setSaving(null);
    await waitFor(() => { expect(onOpenChange).toHaveBeenCalledWith(false); });
    await act(async () => { await Promise.resolve(); });
    expect(onOpenChange).toHaveBeenCalledTimes(1);
  });

  it("shows each basis's description", () => {
    renderSheet(BASIS_COPY, "invoiced");
    expect(screen.getByRole("radio", { name: /^תאריך חשבונית/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("נספר לפי תאריך המסמך, גם אם עוד לא שולם.")).toBeInTheDocument();
    expect(screen.getByText(BASIS_SHEET_SUBTITLE)).toBeInTheDocument();
  });

  it("lists the paces shortest first, with the stored one checked", () => {
    renderSheet(paceSheetCopy(null), "2months");
    expect(screen.getByRole("radiogroup", { name: "כל כמה זמן" })).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((radio) => radio.getAttribute("data-value"))).toEqual(["never", "month", "2months", "quarter", "year"]);
    expect(screen.getByRole("radio", { name: "כל חודשיים" })).toBeChecked();
  });

  it("renders no note paragraph when the copy has no note", () => {
    renderSheet(paceSheetCopy(null), "month");
    expect(document.querySelector(".ui-pick-note")).toBeNull();
  });
});
