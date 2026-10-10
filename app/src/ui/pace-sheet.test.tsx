import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { PaceSheet } from "./pace-sheet";

function show(props: Partial<Parameters<typeof PaceSheet>[0]> = {}) {
  const onPick = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <MemoryRouter>
      <PaceSheet open value="month" saving={null} onOpenChange={onOpenChange} onPick={onPick} {...props} />
    </MemoryRouter>,
  );
  return { onPick, onOpenChange };
}

describe("PaceSheet (FLOW-415 D)", () => {
  it("lists the four paces, shortest first, with the current one chosen", () => {
    show({ value: "2months" });
    expect(screen.getByRole("radiogroup", { name: "כל כמה זמן" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("aria-label") ?? radio.textContent)).toHaveLength(4);
    expect(screen.getByRole("radio", { name: "כל חודשיים" })).toBeChecked();
  });

  it("picks a new pace, and only closes on the current one", () => {
    const { onPick, onOpenChange } = show();
    fireEvent.click(screen.getByRole("radio", { name: "כל שנה" }));
    expect(onPick).toHaveBeenCalledWith("year", expect.any(Function));
    fireEvent.click(screen.getByRole("radio", { name: "כל חודש" }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("waits while a pace saves", () => {
    const { onPick } = show({ saving: "quarter" });
    fireEvent.click(screen.getByRole("radio", { name: "כל שנה" }));
    expect(onPick).not.toHaveBeenCalled();
  });
});
