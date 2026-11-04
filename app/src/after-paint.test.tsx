import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAfterFirstPaint } from "./after-paint";

afterEach(() => {
  vi.useRealTimers();
});

describe("useAfterFirstPaint (FLOW-1019)", () => {
  it("stays false while the screen is not drawn, turns true after it is, and stays true", async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ shown }) => useAfterFirstPaint(shown), { initialProps: { shown: false } });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(result.current).toBe(false);
    rerender({ shown: true });
    expect(result.current).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(result.current).toBe(true);
    rerender({ shown: false });
    expect(result.current).toBe(true);
  });

  it("is true at once when the screen mounts already drawn (a return to it, its data cached)", () => {
    const { result } = renderHook(() => useAfterFirstPaint(true));
    expect(result.current).toBe(true);
  });
});
