import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { resetScrollToWarning, ScrollMemory } from "./back";

let y = 0;
/** Saved spots live for the app's life, so each test starts on an entry of its own. */
let run = 0;

function Page() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  return (
    <>
      <ScrollMemory />
      <p data-testid="at">{pathname + search}</p>
      <button type="button" onClick={() => { void navigate("/projects/p1/profit/2026-10"); }}>month</button>
      <button type="button" onClick={() => { void navigate("/transactions/b", { replace: true }); }}>replace</button>
      <button type="button" onClick={() => { void navigate("/list?period=all"); }}>query</button>
      <button type="button" onClick={() => { void navigate("/list", { state: { flowLayer: "sheet" } }); }}>sheet</button>
      <button type="button" onClick={() => { void navigate(-1); }}>back</button>
    </>
  );
}

/** The user scrolled the page to `top`: the browser moves the window, then fires scroll. */
function scrollPage(top: number) {
  y = top;
  fireEvent.scroll(window);
}

/** jsdom lets back.tsx call scrollTo once per process; each step here is its own call. */
function tap(name: string) {
  resetScrollToWarning();
  fireEvent.click(screen.getByRole("button", { name }));
}

describe("ScrollMemory", () => {
  let scrollTo: MockInstance<typeof window.scrollTo>;

  beforeEach(() => {
    y = 0;
    run += 1;
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => y });
    scrollTo = vi.spyOn(window, "scrollTo").mockImplementation((_x?: unknown, top?: number) => { y = top ?? 0; });
    render(
      <MemoryRouter initialEntries={[{ pathname: "/list", key: `start-${String(run)}` }]}>
        <Page />
      </MemoryRouter>,
    );
  });

  afterEach(() => {
    scrollTo.mockRestore();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    resetScrollToWarning();
  });

  it("starts a screen opened from a scrolled list at the top", () => {
    scrollPage(1400);
    tap("month");
    expect(screen.getByTestId("at")).toHaveTextContent("/projects/p1/profit/2026-10");
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(y).toBe(0);
  });

  it("starts a replaced screen at the top too (prev and next on a card)", () => {
    scrollPage(500);
    tap("replace");
    expect(screen.getByTestId("at")).toHaveTextContent("/transactions/b");
    expect(y).toBe(0);
  });

  it("keeps the scroll for a new entry on the same screen: a sheet, or a period in the query", () => {
    scrollPage(700);
    tap("sheet");
    tap("query");
    expect(screen.getByTestId("at")).toHaveTextContent("/list?period=all");
    expect(scrollTo).not.toHaveBeenCalled();
    expect(y).toBe(700);
  });

  it("puts the list back where it was on Back, from the scroll seen before the switch", () => {
    scrollPage(1400);
    tap("month");
    expect(y).toBe(0);
    scrollPage(30);
    tap("back");
    expect(screen.getByTestId("at")).toHaveTextContent("/list");
    expect(scrollTo).toHaveBeenLastCalledWith(0, 1400);
    expect(y).toBe(1400);
  });
});
