import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DelayedSkeleton, ListSkeleton, SKELETON_DELAY_MS } from "./skeleton";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DelayedSkeleton (FLOW-371)", () => {
  it("renders nothing before 300ms, then the skeleton", () => {
    const { container } = render(
      <DelayedSkeleton>
        <ListSkeleton />
      </DelayedSkeleton>,
    );
    expect(SKELETON_DELAY_MS).toBe(300);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("status")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS - 1);
    });
    expect(container).toBeEmptyDOMElement();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole("status")).toHaveTextContent("טוען…");
    expect(container.querySelectorAll(".ui-skel-row")).toHaveLength(6);
  });

  it("never shows when the load ends first", () => {
    const { container, unmount } = render(
      <DelayedSkeleton>
        <ListSkeleton />
      </DelayedSkeleton>,
    );
    act(() => {
      vi.advanceTimersByTime(120);
    });
    unmount();
    expect(container).toBeEmptyDOMElement();
    // The timer is cleared on unmount, so nothing fires afterwards.
    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS);
    });
    expect(container).toBeEmptyDOMElement();
  });
});
