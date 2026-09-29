import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { placeToast, ToastProvider, useToast } from "./toast";

function Probe({ tone, message = "הפריט אושר" }: { tone?: "ok" | "bad" | "info"; message?: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() => {
        toast.show({ message, tone });
      }}
    >
      הצגה
    </button>
  );
}

describe("Toast", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pauses the timer on hover and resumes it afterwards", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Probe />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "הצגה" }));
    expect(screen.getByRole("status")).toHaveTextContent("הפריט אושר");
    fireEvent.mouseEnter(screen.getByRole("status"));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    fireEvent.mouseLeave(screen.getByRole("status"));
    act(() => {
      vi.advanceTimersByTime(2_499);
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(screen.getByRole("status")).not.toHaveTextContent("הפריט אושר");
    expect(document.querySelector(".ui-toast")).toBeNull();
  });

  it("leaves an error up longer, and a new toast replaces the one on screen", () => {
    vi.useFakeTimers();
    function Two() {
      const toast = useToast();
      return (
        <>
          <button type="button" onClick={() => { toast.show({ message: "הפריט אושר" }); }}>אישור</button>
          <button type="button" onClick={() => { toast.show({ tone: "bad", message: "לא נשמר" }); }}>כשל</button>
        </>
      );
    }
    render(
      <ToastProvider>
        <Two />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "אישור" }));
    expect(screen.getByRole("status")).toHaveTextContent("הפריט אושר");
    fireEvent.click(screen.getByRole("button", { name: "כשל" }));
    expect(screen.getByRole("status")).toHaveTextContent("לא נשמר");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(2_500);
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1_500);
    });
    expect(screen.getByRole("status")).not.toHaveTextContent("לא נשמר");
    expect(document.querySelector(".ui-toast")).toBeNull();
  });

  it("dismisses on tap and on a swipe, and does not cover the page", () => {
    render(
      <ToastProvider>
        <Probe />
        <button type="button">דלג</button>
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "הצגה" }));
    const status = screen.getByRole("status");
    expect(status.parentElement).toHaveClass("ui-toast-host");
    expect(getComputedStyle(status.parentElement ?? status).pointerEvents).toBe("none");
    expect(getComputedStyle(status).pointerEvents).toBe("auto");
    fireEvent.click(status);
    expect(screen.getByRole("status")).not.toHaveTextContent("הפריט אושר");
    expect(document.querySelector(".ui-toast")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "הצגה" }));
    const again = screen.getByRole("status");
    fireEvent.pointerDown(again, { clientX: 20, clientY: 20, pointerType: "touch" });
    fireEvent.pointerUp(again, { clientX: 120, clientY: 20, pointerType: "touch" });
    expect(screen.getByRole("status")).not.toHaveTextContent("הפריט אושר");
    expect(document.querySelector(".ui-toast")).toBeNull();
    expect(screen.getByRole("button", { name: "דלג" })).toBeEnabled();
  });

  it("runs a toast action once when the tap is repeated before the toast closes", () => {
    let calls = 0;
    function ActionProbe() {
      const toast = useToast();
      return (
        <button
          type="button"
          onClick={() => {
            toast.show({
              tone: "bad",
              message: "לא נשמר",
              action: "ביטול",
              onAction: () => {
                calls += 1;
                screen.getByRole("button", { name: "ביטול" }).click();
              },
            });
          }}
        >
          הצגה
        </button>
      );
    }
    render(
      <ToastProvider>
        <ActionProbe />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "הצגה" }));
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    expect(calls).toBe(1);
    expect(screen.getByRole("status")).not.toHaveTextContent("לא נשמר");
    expect(document.querySelector(".ui-toast")).toBeNull();
  });

  it("keeps an undo action for about five seconds", () => {
    vi.useFakeTimers();
    function Undo() {
      const toast = useToast();
      return (
        <button
          type="button"
          onClick={() => {
            toast.show({ message: "השיוך נשמר", action: "ביטול", onAction: () => undefined });
          }}
        >
          הצגה
        </button>
      );
    }
    render(
      <ToastProvider>
        <Undo />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "הצגה" }));
    expect(screen.getByRole("status")).toHaveTextContent("השיוך נשמר");
    act(() => {
      vi.advanceTimersByTime(2_500);
    });
    expect(screen.getByRole("button", { name: "ביטול" })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2_499);
    });
    expect(screen.getByRole("button", { name: "ביטול" })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(screen.queryByRole("button", { name: "ביטול" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).not.toHaveTextContent("השיוך נשמר");
  });

  it("keeps an info notice out of the error colour", () => {
    render(
      <ToastProvider>
        <Probe tone="info" message="במצב תצוגה זה לא נשמר." />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "הצגה" }));
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("במצב תצוגה זה לא נשמר.");
    expect(status.querySelector(".ui-toast-bad")).toBeNull();
  });
});

describe("placeToast", () => {
  const innerHeight = window.innerHeight;

  afterEach(() => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: innerHeight });
  });

  function box(bottom: number, height: number): DOMRect {
    return {
      x: 0,
      y: bottom - height,
      width: 120,
      height,
      top: bottom - height,
      right: 120,
      bottom,
      left: 0,
      toJSON: () => ({}),
    };
  }

  it("clamps a toast measured below the viewport, then sits under the header once the sheet settles", () => {
    const sheet = document.createElement("div");
    sheet.setAttribute("data-vaul-drawer", "");
    sheet.setAttribute("data-state", "open");
    const header = document.createElement("div");
    header.className = "ui-sheet-head";
    sheet.appendChild(header);
    const host = document.createElement("div");
    const toast = document.createElement("div");
    toast.className = "ui-toast";
    host.appendChild(toast);
    document.body.append(sheet, host);
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 700 });
    header.getBoundingClientRect = () => box(820, 40);
    toast.getBoundingClientRect = () => box(48, 48);
    placeToast(host);
    expect(Number.parseFloat(host.style.top) + 48).toBeLessThanOrEqual(700);
    header.getBoundingClientRect = () => box(120, 40);
    placeToast(host);
    expect(host.style.top).toBe("128px");
    sheet.remove();
    host.remove();
  });

  it("clears every control, and shrinks into the open gap when the toast cannot", () => {
    const header = document.createElement("header");
    header.className = "ui-page";
    const first = document.createElement("button");
    const second = document.createElement("button");
    const host = document.createElement("div");
    const toast = document.createElement("div");
    toast.className = "ui-toast";
    host.appendChild(toast);
    document.body.append(header, first, second, host);
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 200 });
    header.getBoundingClientRect = () => box(20, 20);
    first.getBoundingClientRect = () => box(80, 40);
    second.getBoundingClientRect = () => box(160, 40);
    toast.getBoundingClientRect = () => box(48, 48);
    placeToast(host);
    const top = Number.parseFloat(host.style.top);
    const used = toast.style.maxHeight === "" ? 48 : Number.parseFloat(toast.style.maxHeight);
    const bottom = top + used;
    expect(bottom).toBeLessThanOrEqual(200);
    expect(bottom <= 40 || top >= 80).toBe(true);
    expect(bottom <= 120 || top >= 160).toBe(true);
    header.remove();
    first.remove();
    second.remove();
    host.remove();
  });

  it("moves below a control it would cover", () => {
    const header = document.createElement("header");
    header.className = "ui-page";
    const button = document.createElement("button");
    button.textContent = "אישור";
    const host = document.createElement("div");
    const toast = document.createElement("div");
    toast.className = "ui-toast";
    host.appendChild(toast);
    document.body.append(header, button, host);
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 700 });
    header.getBoundingClientRect = () => box(40, 40);
    button.getBoundingClientRect = () => box(90, 40);
    toast.getBoundingClientRect = () => box(48, 48);
    placeToast(host);
    expect(host.style.top).toBe("98px");
    header.remove();
    button.remove();
    host.remove();
  });
});