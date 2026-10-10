import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChargeSwitches, chargeSwitchToast, IN_CASH, RECURRING, recurringHint } from "./charge-switches";

describe("ChargeSwitches (FLOW-415)", () => {
  const state = { inCash: true, recurring: true, typicalDay: 4, detected: true };

  it("draws נספר בתזרים and חיוב קבוע with the usual day and זוהה לבד", () => {
    render(<ChargeSwitches state={state} onCash={() => undefined} onRecurring={() => undefined} />);
    expect(screen.getByRole("switch", { name: IN_CASH })).toBeChecked();
    const recurring = screen.getByRole("switch", { name: RECURRING });
    expect(recurring).toBeChecked();
    // FLOW-351: each part keeps its words together, and the "·" leads the second part.
    const hint = recurring.closest("label")?.querySelector(".ui-row-hint");
    expect(hint?.textContent).toBe("בדרך כלל ב־4 לחודש · זוהה לבד");
    expect([...(hint?.querySelectorAll(".ui-nowrap") ?? [])].map((part) => part.textContent)).toEqual(["בדרך כלל ב־4 לחודש", "· זוהה לבד"]);
  });

  it("calls back with the next value, and not while disabled", () => {
    const onCash = vi.fn();
    const onRecurring = vi.fn();
    const { rerender } = render(<ChargeSwitches state={state} onCash={onCash} onRecurring={onRecurring} />);
    fireEvent.click(screen.getByRole("switch", { name: IN_CASH }));
    fireEvent.click(screen.getByRole("switch", { name: RECURRING }));
    expect(onCash).toHaveBeenCalledWith(false);
    expect(onRecurring).toHaveBeenCalledWith(false);
    rerender(<ChargeSwitches state={state} disabled onCash={onCash} onRecurring={onRecurring} />);
    fireEvent.click(screen.getByRole("switch", { name: IN_CASH }));
    expect(onCash).toHaveBeenCalledTimes(1);
  });

  it("words the hint from what the server knows, or leaves it out", () => {
    expect(recurringHint({ typicalDay: 4, detected: false })).toBe("בדרך כלל ב־4 לחודש");
    expect(recurringHint({ typicalDay: null, detected: true })).toBe("זוהה לבד");
    expect(recurringHint({ typicalDay: null, detected: false })).toBeUndefined();
  });

  it("says what changed on the undo toast", () => {
    expect(chargeSwitchToast("אור חשמל", "cash", false)).toBe("אור חשמל · לא נספר בתזרים");
    expect(chargeSwitchToast("אור חשמל", "recurring", true)).toBe("אור חשמל · חיוב קבוע");
  });
});
