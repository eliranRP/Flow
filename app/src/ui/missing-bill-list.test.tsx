import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissingBillList } from "./missing-bill-list";
import { SKELETON_DELAY_MS } from "./skeleton";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MissingBillList loading (FLOW-371)", () => {
  it("renders nothing for the first 300ms, then the recurring skeleton", () => {
    const { container } = render(<MissingBillList rows={[]} phase={{ kind: "loading" }} />);
    expect(container).toBeEmptyDOMElement();

    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS - 1);
    });
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("status")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole("status")).toHaveTextContent("טוען…");
    expect(container.querySelector(".ui-skeleton-bar")).not.toBeNull();
  });
});
