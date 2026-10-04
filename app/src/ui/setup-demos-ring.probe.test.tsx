import { act, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { APPROVAL_DEMO_MS, FirstApprovalDemo } from "./setup-demos";

afterEach(() => {
  vi.useRealTimers();
});

it("shows the tap ring on אישור before the card leaves", () => {
  vi.useFakeTimers();
  render(<FirstApprovalDemo />);
  let peak = 0;
  for (let t = 0; t < APPROVAL_DEMO_MS * 0.32; t += 16) {
    act(() => {
      vi.advanceTimersByTime(16);
    });
    const ring = document.querySelector<HTMLElement>(".ui-setup-ring");
    peak = Math.max(peak, Number(ring?.style.getPropertyValue("--setup-ring") || 0));
  }
  expect(peak).toBeGreaterThan(0.9);
  vi.useRealTimers();
});