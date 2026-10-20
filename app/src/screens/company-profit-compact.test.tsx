import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPANY_PROFIT_SAMPLE } from "../dev/company-profit-sample";
import { COMPANY_YEARS_SAMPLE } from "../dev/company-years-sample";
import { renderWithProviders } from "../test-render";
import { stubPageObserver } from "../ui/test-support";
import { CompanyProfitScreen, type CompanyProfitSample } from "./company-profit-screen";

/**
 * The company profit page's compact bar and chips panel stay up while the page is at its top, after the
 * header's mark moves: the year's read swapping its skeleton for the year (the page Back opens from a
 * project's profit page, `?period=year&list=project`), and the period switch turning to and from
 * since the start, whose view has no chips.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function bar(): HTMLElement {
  const node = document.querySelector(".ui-cp-screen .ui-compact-bar");
  if (!(node instanceof HTMLElement)) throw new Error("no compact bar");
  return node;
}

function expectBarUp() {
  expect(bar()).toHaveAttribute("aria-hidden", "true");
  expect(document.documentElement).not.toHaveAttribute("data-compact-bar");
}

function switchRadio(name: string): HTMLElement {
  return within(screen.getByRole("radiogroup", { name: "תקופה" })).getByRole("radio", { name });
}

describe("the company profit page's compact bar at the top", () => {
  it("stays up when the year's skeleton gives way to the year, back from a project", () => {
    const observer = stubPageObserver();
    // The years' read still out: the switch shows over a skeleton.
    const waiting = { ...COMPANY_PROFIT_SAMPLE, years: { ...COMPANY_YEARS_SAMPLE, months: null } } as unknown as CompanyProfitSample;
    const view = renderWithProviders(<CompanyProfitScreen sample={waiting} />, { route: "/profit?period=year&list=project" });
    expect(document.querySelector(".ui-cp-chips")).toBeNull();
    observer.settle();
    expectBarUp();
    view.rerender(<CompanyProfitScreen sample={COMPANY_PROFIT_SAMPLE} />);
    expect(screen.getAllByRole("button", { name: "לפי פרויקט" }).length).toBeGreaterThan(0);
    observer.settle();
    expectBarUp();
  });

  it("stays up from since the start to 2026, and on through the switch to the month", () => {
    const observer = stubPageObserver();
    // Since the start has no chips: its mark sits under the title, in view, and 2026 moves it under the chips.
    renderWithProviders(<CompanyProfitScreen sample={COMPANY_PROFIT_SAMPLE} />, { route: "/profit?period=all" });
    for (const name of ["2026", "מההתחלה", "2026", "אוקטובר"]) {
      fireEvent.click(switchRadio(name));
      expect(switchRadio(name)).toHaveAttribute("aria-checked", "true");
      observer.settle();
      expectBarUp();
    }
    // Scrolled down, the bar still comes down.
    observer.page.scrolled = true;
    observer.settle();
    expect(bar()).toHaveAttribute("aria-hidden", "false");
  });
});
