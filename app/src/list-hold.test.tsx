import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SCROLL_SETTLE_MS, holdActive, installListHold, resetListHold, useHeldOrder } from "./list-hold";

function Probe({ rows }: { rows: Array<{ id: string; name: string }> }) {
  const ordered = useHeldOrder(rows, (row) => row.id);
  return (
    <ol>
      {ordered.map((row) => (
        <li key={row.id} className="ui-row">{row.name}</li>
      ))}
    </ol>
  );
}

function names(): string[] {
  return screen.getAllByRole("listitem").map((item) => item.textContent);
}

function withFocusVisible(visible: (element: HTMLElement) => boolean, run: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "matches");
  const value: unknown = descriptor?.value;
  if (descriptor == null || typeof value !== "function") throw new Error("matches");
  const original = value as (this: HTMLElement, selector: string) => boolean;
  Object.defineProperty(Element.prototype, "matches", {
    configurable: true,
    writable: true,
    value(this: HTMLElement, selector: string) {
      if (selector === ":focus-visible") return visible(this);
      return original.call(this, selector);
    },
  });
  try {
    run();
  } finally {
    Object.defineProperty(Element.prototype, "matches", descriptor);
  }
}

describe("held list order", () => {
  let stop = (): void => undefined;
  afterEach(() => {
    stop();
    resetListHold();
    vi.useRealTimers();
  });

  it("keeps the order while a row is pressed, then applies it", () => {
    stop = installListHold();
    const { rerender } = render(<Probe rows={[{ id: "a", name: "אלפא" }, { id: "b", name: "ביתא" }]} />);
    fireEvent.pointerDown(screen.getByText("אלפא"));
    rerender(<Probe rows={[{ id: "b", name: "ביתא" }, { id: "a", name: "אלפא" }]} />);
    expect(names()).toEqual(["אלפא", "ביתא"]);
    fireEvent.pointerUp(screen.getByText("אלפא"));
    rerender(<Probe rows={[{ id: "b", name: "ביתא" }, { id: "a", name: "אלפא" }]} />);
    expect(names()).toEqual(["ביתא", "אלפא"]);
  });

  it("drops a removed row and appends a new one while held", () => {
    stop = installListHold();
    const { rerender } = render(<Probe rows={[{ id: "a", name: "אלפא" }, { id: "b", name: "ביתא" }]} />);
    fireEvent.pointerDown(screen.getByText("אלפא"));
    rerender(<Probe rows={[{ id: "b", name: "ביתא" }, { id: "c", name: "גימל" }]} />);
    expect(names()).toEqual(["ביתא", "גימל"]);
  });

  it("waits until scrolling settles", () => {
    vi.useFakeTimers();
    stop = installListHold();
    const { rerender } = render(<Probe rows={[{ id: "a", name: "אלפא" }, { id: "b", name: "ביתא" }]} />);
    act(() => {
      document.dispatchEvent(new Event("scroll"));
    });
    rerender(<Probe rows={[{ id: "b", name: "ביתא" }, { id: "a", name: "אלפא" }]} />);
    expect(names()).toEqual(["אלפא", "ביתא"]);
    act(() => {
      vi.advanceTimersByTime(SCROLL_SETTLE_MS);
    });
    rerender(<Probe rows={[{ id: "b", name: "ביתא" }, { id: "a", name: "אלפא" }]} />);
    expect(names()).toEqual(["ביתא", "אלפא"]);
  });

  it("holds while a sheet is open or focus is inside a row", async () => {
    stop = installListHold();
    const start = [{ id: "a", name: "אלפא" }, { id: "b", name: "ביתא" }];
    const flipped = [{ id: "b", name: "ביתא" }, { id: "a", name: "אלפא" }];
    function Rows({ rows }: { rows: typeof start }) {
      const ordered = useHeldOrder(rows, (row) => row.id);
      return (
        <ol>
          {ordered.map((row) => (
            <li key={row.id} className="ui-row">
              {row.name}
              <input aria-label={row.name} />
            </li>
          ))}
        </ol>
      );
    }
    const { rerender } = render(<Rows rows={start} />);
    const drawer = document.createElement("div");
    drawer.setAttribute("data-vaul-drawer", "");
    drawer.setAttribute("data-state", "open");
    await act(async () => {
      document.body.append(drawer);
      await new Promise((resolve) => { window.setTimeout(resolve, 0); });
    });
    expect(holdActive()).toBe(true);
    rerender(<Rows rows={flipped} />);
    expect(names()).toEqual(["אלפא", "ביתא"]);
    await act(async () => {
      drawer.setAttribute("data-state", "closed");
      await new Promise((resolve) => { window.setTimeout(resolve, 0); });
    });
    expect(holdActive()).toBe(false);
    expect(names()).toEqual(["ביתא", "אלפא"]);
    rerender(<Rows rows={start} />);
    act(() => {
      screen.getByRole("textbox", { name: "אלפא" }).focus();
    });
    expect(holdActive()).toBe(true);
    rerender(<Rows rows={flipped} />);
    expect(names()).toEqual(["אלפא", "ביתא"]);
    const outside = document.createElement("button");
    document.body.append(outside);
    act(() => {
      outside.focus();
    });
    expect(holdActive()).toBe(false);
    expect(names()).toEqual(["ביתא", "אלפא"]);
    drawer.remove();
    outside.remove();
  });

  it("does not hold when focus returns to a row", () => {
    stop = installListHold();
    withFocusVisible(() => false, () => {
      render(
        <ol>
          <li className="ui-row"><button type="button">אלפא</button></li>
        </ol>,
      );
      act(() => {
        screen.getByRole("button", { name: "אלפא" }).focus();
      });
      expect(holdActive()).toBe(false);
    });
  });

  it("holds keyboard focus on a row", () => {
    stop = installListHold();
    withFocusVisible((element) => element.dataset.focusVisible === "true", () => {
      render(
        <ol>
          <li className="ui-row"><button type="button" data-focus-visible="true">אלפא</button></li>
        </ol>,
      );
      act(() => {
        screen.getByRole("button", { name: "אלפא" }).focus();
      });
      expect(holdActive()).toBe(true);
    });
  });

  it("counts each pointer once", () => {
    stop = installListHold();
    render(
      <ol>
        <li className="ui-row">אלפא</li>
      </ol>,
    );
    const row = screen.getByText("אלפא");
    fireEvent.pointerDown(row, { pointerId: 1 });
    fireEvent.pointerDown(row, { pointerId: 2 });
    fireEvent.pointerUp(row, { pointerId: 7 });
    expect(holdActive()).toBe(true);
    fireEvent.pointerUp(row, { pointerId: 1 });
    expect(holdActive()).toBe(true);
    fireEvent.pointerUp(row, { pointerId: 2 });
    expect(holdActive()).toBe(false);
  });
});
