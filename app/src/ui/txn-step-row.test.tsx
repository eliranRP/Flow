import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TxnStepRow } from "./txn-step-row";

function row(props: Partial<Parameters<typeof TxnStepRow>[0]> = {}) {
  return (
    <TxnStepRow index={2} total={3} atStart={false} atEnd={false} onPrev={() => undefined} onNext={() => undefined} {...props} />
  );
}

describe("the step row (FLOW-345)", () => {
  let report: ((entry: Partial<IntersectionObserverEntry>) => void) | null = null;
  let margin = "";
  let watched: Element | null = null;
  function observe() {
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        margin = options?.rootMargin ?? "";
        report = (entry) => { callback([entry as IntersectionObserverEntry], this as unknown as IntersectionObserver); };
      }
      observe(node: Element) {
        watched = node;
      }
      disconnect() {}
    });
  }
  afterEach(() => {
    vi.unstubAllGlobals();
    report = null;
    watched = null;
  });

  function contentEnd(at: "above" | "under") {
    act(() => {
      report?.({
        isIntersecting: at === "above",
        boundingClientRect: { top: at === "above" ? 500 : 900 } as DOMRectReadOnly,
        rootBounds: { bottom: 790 } as DOMRectReadOnly,
      });
    });
  }

  it("draws the hairline only while card content is scrolled under it", () => {
    observe();
    render(row());
    const group = screen.getByRole("group", { name: "מעבר בין תנועות" });
    // It watches the mark just before it, with the viewport's bottom raised by the row's height.
    expect(watched).toBe(group.previousElementSibling);
    expect(watched).toHaveClass("ui-txn-step-end");
    expect(margin).toMatch(/^0px 0px -\d+px 0px$/);
    expect(group).not.toHaveAttribute("data-under");
    contentEnd("under");
    expect(group).toHaveAttribute("data-under");
    contentEnd("above");
    expect(group).not.toHaveAttribute("data-under");
  });

  it("stays flat without an observer", () => {
    render(row());
    expect(screen.getByRole("group", { name: "מעבר בין תנועות" })).not.toHaveAttribute("data-under");
  });

  it("hides an end word with a class, keeping its box and its place", () => {
    render(row({ index: 1, atStart: true }));
    const prev = screen.getByText("הקודמת").closest("button");
    expect(prev).toHaveClass("ui-txn-step-btn", "ui-txn-step-off");
    expect(prev).not.toHaveAttribute("style");
    expect(screen.getByRole("button", { name: "התנועה הבאה" })).not.toHaveClass("ui-txn-step-off");
  });

  it("names the counter plainly, with no reserved digits", () => {
    render(row({ index: 7, total: 24 }));
    expect(screen.getByText("7 מתוך 24")).toHaveClass("sr-only");
    const drawn = document.querySelector(".ui-txn-step-count > [aria-hidden='true']");
    expect(drawn?.querySelector("[data-reserve='00']")).toHaveTextContent("7");
  });
});
