import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "./toast";

/** FLOW-1167: a hover, focus or press pauses a toast only while it lasts, and only the toast it began on. */

function Probe() {
  const toast = useToast();
  return (
    <>
      <button type="button" onClick={() => { toast.show({ message: "נשמר", action: "ביטול", onAction: () => undefined }); }}>
        עם פעולה
      </button>
      <button type="button" onClick={() => { toast.show({ message: "הפריט אושר" }); }}>
        בלי פעולה
      </button>
    </>
  );
}

function advance(ms: number) {
  act(() => { vi.advanceTimersByTime(ms); });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Toast · holds", () => {
  it("resumes after a mouse press that is released outside the toast", () => {
    vi.useFakeTimers();
    render(<ToastProvider><Probe /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "בלי פעולה" }));
    fireEvent.pointerDown(screen.getByRole("status"), { pointerType: "mouse", button: 0, clientX: 4, clientY: 4 });
    advance(10_000);
    expect(screen.getByRole("status")).toHaveTextContent("הפריט אושר");
    fireEvent.pointerUp(document.body, { pointerType: "mouse", button: 0, clientX: 4, clientY: 300 });
    advance(4_020);
    expect(document.querySelector(".ui-toast")).toBeNull();
  });

  it("pauses a replacement toast on hover, though the focus that held the one before it went with its action", () => {
    vi.useFakeTimers();
    render(<ToastProvider><Probe /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "עם פעולה" }));
    act(() => { screen.getByRole("button", { name: "ביטול" }).focus(); });
    fireEvent.click(screen.getByRole("button", { name: "בלי פעולה" }));
    expect(screen.getByRole("status")).toHaveTextContent("הפריט אושר");
    fireEvent.mouseEnter(screen.getByRole("status"));
    advance(10_000);
    expect(screen.getByRole("status")).toHaveTextContent("הפריט אושר");
    fireEvent.mouseLeave(screen.getByRole("status"));
    advance(4_020);
    expect(document.querySelector(".ui-toast")).toBeNull();
  });
});
