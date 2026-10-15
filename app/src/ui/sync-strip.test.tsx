import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SYNC_PILL_DELAY_MS, SyncStrip } from "./sync-strip";
import { expectRtl } from "./test-support";

const label = "מסנכרן עם Mercury…";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SyncStrip (FLOW-371)", () => {
  it("renders nothing when no sync runs", () => {
    expectRtl();
    const { container } = render(<SyncStrip label={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the line at once and the pill after 200ms, with the label in both", () => {
    const { container } = render(<SyncStrip label={label} />);
    expect(SYNC_PILL_DELAY_MS).toBe(200);
    expect(container.querySelector(".ui-sync-line")).not.toBeNull();
    // Before the pill, the label is for a screen reader only, so the strip still says what syncs.
    expect(screen.getByRole("status")).toHaveTextContent(label);
    expect(container.querySelector(".ui-sync-pill")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(SYNC_PILL_DELAY_MS);
    });
    expect(container.querySelector(".ui-sync-pill")).toHaveTextContent(label);
    expect(container.querySelector(".ui-sync-spin")).not.toBeNull();
  });

  it("waits 200ms again for each new sync", () => {
    const { container, rerender } = render(<SyncStrip label={label} />);
    act(() => {
      vi.advanceTimersByTime(SYNC_PILL_DELAY_MS);
    });
    expect(container.querySelector(".ui-sync-pill")).not.toBeNull();

    rerender(<SyncStrip label={null} />);
    expect(container).toBeEmptyDOMElement();

    rerender(<SyncStrip label={label} />);
    expect(container.querySelector(".ui-sync-pill")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(SYNC_PILL_DELAY_MS);
    });
    expect(container.querySelector(".ui-sync-pill")).not.toBeNull();
  });
});
