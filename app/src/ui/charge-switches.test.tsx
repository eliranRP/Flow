import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChargeSwitches, chargeSwitchToast, IN_CASH, PACE_LABEL, paceToast, RECURRING, recurringHint } from "./charge-switches";

describe("ChargeSwitches (FLOW-415)", () => {
  const state = { inCash: true, recurring: true, typicalDay: 4, detected: true };

  it("draws נספר בתזרים and חיוב קבוע with the usual day and זוהה לבד", () => {
    render(<ChargeSwitches state={state} onCash={() => undefined} onRecurring={() => undefined} />);
    expect(screen.getByRole("switch", { name: IN_CASH })).toBeChecked();
    const recurring = screen.getByRole("switch", { name: RECURRING });
    expect(recurring).toBeChecked();
    const hint = recurring.closest("label")?.querySelector(".ui-row-hint");
    expect(hint?.textContent).toBe("כל חודש · בערך ב־4 · זוהה לבד");
    // Each part keeps its words; the "·" opens the next part, where a wrap clips it.
    expect([...(hint?.querySelectorAll(".ui-hint-wrap-part") ?? [])].map((part) => part.textContent)).toEqual(["כל חודש", " · בערך ב־4", " · זוהה לבד"]);
    expect(hint?.querySelector(".ui-hint-wrap-sep")).toHaveAttribute("aria-hidden", "true");
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
    expect(recurringHint({ typicalDay: 4, detected: false, pace: "2months" })).toBe("כל חודשיים · בערך ב־4");
    expect(recurringHint({ typicalDay: null, detected: true, pace: "year" })).toBe("כל שנה · זוהה לבד");
    expect(recurringHint({ typicalDay: null, detected: false })).toBe("כל חודש");
    expect(PACE_LABEL).toEqual({ month: "כל חודש", "2months": "כל חודשיים", quarter: "כל רבעון", year: "כל שנה" });
  });

  it("opens the pace from the row while on, and keeps the switch apart (FLOW-415 D)", () => {
    const onPace = vi.fn();
    const onRecurring = vi.fn();
    const { rerender } = render(<ChargeSwitches state={state} onCash={() => undefined} onRecurring={onRecurring} onPace={onPace} />);
    fireEvent.click(screen.getByRole("button", { name: /^חיוב קבוע/ }));
    expect(onPace).toHaveBeenCalledTimes(1);
    expect(onRecurring).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("switch", { name: RECURRING }));
    expect(onRecurring).toHaveBeenCalledWith(false);
    expect(onPace).toHaveBeenCalledTimes(1);
    // Off, disabled or with no party: a plain switch row, no pace.
    rerender(<ChargeSwitches state={{ ...state, recurring: false }} onCash={() => undefined} onRecurring={onRecurring} onPace={onPace} />);
    expect(screen.queryByRole("button", { name: /^חיוב קבוע/ })).toBeNull();
    rerender(<ChargeSwitches state={state} disabled onCash={() => undefined} onRecurring={onRecurring} onPace={onPace} />);
    expect(screen.queryByRole("button", { name: /^חיוב קבוע/ })).toBeNull();
  });

  it("says what changed on the undo toast", () => {
    expect(chargeSwitchToast("אור חשמל", "cash", false)).toBe("אור חשמל · לא נספר בתזרים");
    expect(chargeSwitchToast("אור חשמל", "recurring", true)).toBe("אור חשמל · חיוב קבוע");
    expect(paceToast("אור חשמל", "quarter")).toBe("אור חשמל · כל רבעון");
  });
});
