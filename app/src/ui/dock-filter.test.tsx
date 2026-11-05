import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DockSlot, useDockedFilter } from "./dock-filter";
import { ReducedMotionFrame } from "./reduced-motion";
import { stubPageObserver } from "./test-support";

function Page({ barShown, bar = 64 }: { barShown: boolean; bar?: number }) {
  const { markRef, docked, scrollUnderBar } = useDockedFilter({ barShown, bar });
  return (
    <>
      <span ref={markRef} className="ui-compact-mark" data-testid="mark" />
      <DockSlot docked={docked}>
        <button type="button" onClick={scrollUnderBar}>
          הכול
        </button>
      </DockSlot>
      <p data-testid="docked">{String(docked)}</p>
    </>
  );
}

describe("useDockedFilter and DockSlot (FLOW-1043)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("docks once the mark scrolls under the bar while the bar shows, and fades the in-page copy", () => {
    const { page, settle } = stubPageObserver();
    const { container, rerender } = render(<Page barShown />);
    const slot = container.querySelector(".ui-dock-slot");
    expect(screen.getByTestId("docked")).toHaveTextContent("false");
    expect(slot).not.toHaveAttribute("data-docked");
    expect(slot).not.toHaveAttribute("inert");
    page.scrolled = true;
    settle();
    expect(screen.getByTestId("docked")).toHaveTextContent("true");
    // The copy keeps its height (only opacity changes) and leaves the reader's tree: the bar holds the live one.
    expect(slot).toHaveAttribute("data-docked");
    expect(slot).toHaveAttribute("aria-hidden", "true");
    expect(slot).toHaveAttribute("inert");
    rerender(<Page barShown={false} />);
    expect(screen.getByTestId("docked")).toHaveTextContent("false");
  });

  it("scrolls the list's top under the bar after a pick while docked, instantly under reduced motion", () => {
    const { page, settle } = stubPageObserver();
    const scrollBy = vi.fn();
    vi.stubGlobal("scrollBy", scrollBy);
    render(
      <ReducedMotionFrame>
        <Page barShown bar={64} />
      </ReducedMotionFrame>,
    );
    const mark = screen.getByTestId("mark");
    vi.spyOn(mark, "getBoundingClientRect").mockReturnValue({ top: -300 } as DOMRect);
    fireEvent.click(screen.getByRole("button", { name: "הכול", hidden: true }));
    // Not docked: a pick leaves the scroll alone.
    expect(scrollBy).not.toHaveBeenCalled();
    page.scrolled = true;
    settle();
    fireEvent.click(screen.getByRole("button", { name: "הכול", hidden: true }));
    expect(scrollBy).toHaveBeenCalledWith({ top: -363, behavior: "instant" });
  });
});
