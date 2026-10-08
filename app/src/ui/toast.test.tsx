import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { placeToast, safeTopPx, toastMinBlock, ToastProvider, useToast } from "./toast";

function Probe({ tone, message = "הפריט אושר", place }: { tone?: "ok" | "bad" | "info"; message?: string; place?: "page" | "tab" }) {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() => {
        toast.show({ message, tone, place });
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
      vi.advanceTimersByTime(3_999);
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(screen.getByRole("status")).not.toHaveTextContent("הפריט אושר");
    expect(document.querySelector(".ui-toast")).toBeNull();
  });

  it("pauses the timer while the toast is being touched", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Probe />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "הצגה" }));
    const status = screen.getByRole("status");
    fireEvent.pointerDown(status, { pointerType: "touch", button: 0, clientX: 4, clientY: 4 });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(status).toBeInTheDocument();
    fireEvent.pointerUp(status, { pointerType: "touch", clientX: 6, clientY: 6 });
    act(() => {
      vi.advanceTimersByTime(3_999);
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(20);
    });
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
    expect(getComputedStyle(status).minBlockSize).not.toMatch(/calc|69/);
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

  it("keeps a confirmation under the header after the sheet closes", async () => {
    const innerHeight = window.innerHeight;
    const rect = Object.getOwnPropertyDescriptor(Element.prototype, "getBoundingClientRect");
    if (!rect?.value) throw new Error("getBoundingClientRect is missing");
    const original = rect.value as (this: Element) => DOMRect;
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
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.classList.contains("ui-toast")) return box(48, 48);
      if (this.classList.contains("ui-page")) return box(155, 40);
      if (this.classList.contains("ui-tabbar")) return box(844, 60);
      // Still the open sheet's box while it animates shut. Anchoring there is 554px.
      if (this.hasAttribute("data-vaul-drawer")) return box(844, 234);
      if (this.closest("[data-vaul-drawer]")) return box(400, 220);
      return original.call(this);
    };
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    function Show() {
      const toast = useToast();
      const [open, setOpen] = useState(true);
      return (
        <>
          {open ? (
            <div data-vaul-drawer="" data-state="open">
              <button type="button">בטון</button>
            </div>
          ) : null}
          <button type="button" onClick={() => { toast.show({ message: "השיוך נשמר" }); }}>
            הצגה
          </button>
          <button type="button" onClick={() => { setOpen(false); }}>
            סגירה
          </button>
        </>
      );
    }
    try {
      render(
        <ToastProvider>
          <header className="ui-page" />
          <nav className="ui-tabbar" />
          <Show />
        </ToastProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: "הצגה" }));
      const host = document.querySelector(".ui-toast-host");
      expect(host).toHaveStyle({ top: "163px" });
      const sheet = document.querySelector("[data-vaul-drawer]");
      expect(sheet).not.toBeNull();
      await act(async () => {
        sheet?.setAttribute("data-state", "closed");
        await Promise.resolve();
      });
      expect(host).toHaveStyle({ top: "163px" });
      fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
      await act(async () => {
        await Promise.resolve();
      });
      expect(document.querySelector("[data-vaul-drawer]")).toBeNull();
      expect(document.querySelector(".ui-toast-host")).toHaveStyle({ top: "163px" });
    } finally {
      Element.prototype.getBoundingClientRect = original;
      Object.defineProperty(window, "innerHeight", { configurable: true, value: innerHeight });
    }
  });
});

describe("placeToast", () => {
  const innerHeight = window.innerHeight;

  afterEach(() => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: innerHeight });
    document.documentElement.style.removeProperty("--safe-top");
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

  it("sits a confirmation above the tab bar when Home asks for that place", () => {
    const bar = document.createElement("nav");
    bar.className = "ui-tabbar";
    const host = document.createElement("div");
    host.dataset.place = "tab";
    const toast = document.createElement("div");
    toast.className = "ui-toast";
    host.appendChild(toast);
    document.body.append(bar, host);
    document.documentElement.style.setProperty("--space-4", "16px");
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    bar.getBoundingClientRect = () => box(700, 56);
    toast.getBoundingClientRect = () => box(48, 48);
    placeToast(host);
    expect(host.style.top).toBe("580px");
    expect(host.style.paddingInline).toBe("var(--space-4)");
    bar.remove();
    host.remove();
    document.documentElement.style.removeProperty("--space-4");
  });

  it("sits above an open sheet, and at the screen top when that does not fit", () => {
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
    sheet.getBoundingClientRect = () => box(820, 200);
    header.getBoundingClientRect = () => box(660, 40);
    toast.getBoundingClientRect = () => box(48, 48);
    placeToast(host);
    expect(Number.parseFloat(host.style.top) + 48).toBeLessThanOrEqual(700);
    expect(Number.parseFloat(host.style.top) + 48).toBeLessThanOrEqual(620);
    sheet.getBoundingClientRect = () => box(500, 380);
    header.getBoundingClientRect = () => box(160, 40);
    placeToast(host);
    expect(host.style.top).toBe("64px");
    const top = Number.parseFloat(host.style.top);
    expect(top + 48).toBeLessThanOrEqual(120);
    sheet.remove();
    host.remove();
  });

  it("keeps a page toast under the header while a sheet is open", () => {
    const page = document.createElement("header");
    page.className = "ui-page";
    const bar = document.createElement("nav");
    bar.className = "ui-tabbar";
    const sheet = document.createElement("div");
    sheet.setAttribute("data-vaul-drawer", "");
    sheet.setAttribute("data-state", "open");
    const choice = document.createElement("button");
    sheet.appendChild(choice);
    const host = document.createElement("div");
    host.dataset.place = "page";
    const toast = document.createElement("div");
    toast.className = "ui-toast";
    host.appendChild(toast);
    document.body.append(page, bar, sheet, host);
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    page.getBoundingClientRect = () => box(155, 40);
    bar.getBoundingClientRect = () => box(844, 60);
    sheet.getBoundingClientRect = () => box(844, 480);
    choice.getBoundingClientRect = () => box(200, 40);
    toast.getBoundingClientRect = () => box(48, 48);
    placeToast(host);
    expect(host.style.top).toBe("163px");
    expect(Number.parseFloat(host.style.top) + 48).toBeLessThan(364);
    page.remove();
    bar.remove();
    sheet.remove();
    host.remove();
  });

  it("does not clip the toast when the free gap is shorter than two lines", () => {
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
    expect(toast.style.overflow).not.toBe("hidden");
    expect(toast.style.maxHeight).toBe("");
    header.remove();
    first.remove();
    second.remove();
    host.remove();
  });

  it("shrinks a tall toast only down to two lines", () => {
    const header = document.createElement("header");
    header.className = "ui-page";
    const button = document.createElement("button");
    const host = document.createElement("div");
    const toast = document.createElement("div");
    toast.className = "ui-toast";
    host.appendChild(toast);
    document.body.append(header, button, host);
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 220 });
    header.getBoundingClientRect = () => box(0, 20);
    button.getBoundingClientRect = () => box(140, 40);
    toast.getBoundingClientRect = () => box(0, 160);
    placeToast(host);
    const cap = Number.parseFloat(toast.style.maxHeight);
    expect(toast.style.overflow).toBe("hidden");
    expect(cap).toBeGreaterThanOrEqual(toastMinBlock());
    expect(cap).toBeLessThan(160);
    header.remove();
    button.remove();
    host.remove();
  });

  it("keeps an action, including an info action, for five seconds", () => {
    vi.useFakeTimers();
    function Action() {
      const toast = useToast();
      return (
        <button
          type="button"
          onClick={() => {
            toast.show({
              tone: "info",
              message: "עלות משותפת מפוצלת במסך הפיצול.",
              action: "לפיצול",
              onAction: () => undefined,
            });
          }}
        >
          הצגה
        </button>
      );
    }
    render(
      <ToastProvider>
        <Action />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "הצגה" }));
    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(screen.getByRole("status")).toHaveTextContent("עלות משותפת מפוצלת במסך הפיצול.");
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(document.querySelector(".ui-toast")).toBeNull();
  });

  it("does not sit a one-line toast at y=1.5 above a tall sheet", () => {
    const sheet = document.createElement("div");
    sheet.setAttribute("data-vaul-drawer", "");
    sheet.setAttribute("data-state", "open");
    const surface = document.createElement("div");
    surface.className = "ui-sheet-surface";
    const header = document.createElement("div");
    header.className = "ui-sheet-head";
    surface.appendChild(header);
    sheet.appendChild(surface);
    const host = document.createElement("div");
    const toast = document.createElement("div");
    toast.className = "ui-toast";
    host.appendChild(toast);
    document.body.append(sheet, host);
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 693 });
    // Sheet top 57.5, toast 48, gap 8. The old above position was 1.5.
    sheet.getBoundingClientRect = () => box(697.5, 640);
    header.getBoundingClientRect = () => box(120, 62.5);
    toast.getBoundingClientRect = () => box(48, 48);
    placeToast(host);
    expect(host.style.top).toBe("8px");
    expect(Number.parseFloat(host.style.top)).toBeGreaterThanOrEqual(8);
    sheet.remove();
    host.remove();
  });

  it("keeps a tall toast at its full height in the safe area when the gap is too small", () => {
    const sheet = document.createElement("div");
    sheet.setAttribute("data-vaul-drawer", "");
    sheet.setAttribute("data-state", "open");
    const surface = document.createElement("div");
    surface.className = "ui-sheet-surface";
    const header = document.createElement("div");
    header.className = "ui-sheet-head";
    surface.appendChild(header);
    sheet.appendChild(surface);
    const host = document.createElement("div");
    const toast = document.createElement("div");
    toast.className = "ui-toast";
    host.appendChild(toast);
    document.body.append(sheet, host);
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    sheet.getBoundingClientRect = () => box(76, 40);
    header.getBoundingClientRect = () => box(76, 40);
    toast.getBoundingClientRect = () => box(120, 120);
    placeToast(host);
    expect(host.style.top).toBe("8px");
    expect(toast.style.maxHeight).toBe("");
    expect(toast.style.overflow).not.toBe("hidden");
    expect(surface.dataset.toastPad).toBeUndefined();
    expect(surface.style.getPropertyValue("--toast-pad")).toBe("");
    sheet.remove();
    host.remove();
  });

  it("reads a safe area that is still an env() token", () => {
    document.documentElement.style.setProperty("--safe-top", "env(safe-area-inset-top, 0px)");
    const rect = Object.getOwnPropertyDescriptor(Element.prototype, "getBoundingClientRect");
    if (!rect?.value) throw new Error("getBoundingClientRect is missing");
    const original = rect.value as (this: Element) => DOMRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this instanceof HTMLElement && this.style.blockSize.includes("--safe-top")) {
        return DOMRect.fromRect({ width: 0, height: 47 });
      }
      return original.call(this);
    };
    try {
      expect(safeTopPx()).toBe(47);
    } finally {
      Object.defineProperty(Element.prototype, "getBoundingClientRect", rect);
    }
  });

  it("pads a 320 two-line refusal by the safe area", () => {
    const height = 69;
    const closeTop = 85;
    for (const safe of [20, 47]) {
      document.documentElement.style.setProperty("--safe-top", `${String(safe)}px`);
      const sheet = document.createElement("div");
      sheet.setAttribute("data-vaul-drawer", "");
      sheet.setAttribute("data-state", "open");
      sheet.className = "ui-sheet-tall";
      const surface = document.createElement("div");
      surface.className = "ui-sheet-surface";
      const close = document.createElement("button");
      close.setAttribute("aria-label", "סגירה");
      surface.appendChild(close);
      sheet.appendChild(surface);
      const host = document.createElement("div");
      const toast = document.createElement("div");
      toast.className = "ui-toast";
      toast.textContent = "לא נשמר. בדקו את הפרטים ונסו שוב.";
      host.appendChild(toast);
      document.body.append(sheet, host);
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 700 });
      sheet.getBoundingClientRect = () => box(456, 400);
      close.getBoundingClientRect = () => {
        const applied = Number.parseFloat(surface.dataset.toastPad ?? "") || 0;
        const base = box(closeTop + 44, 44);
        return {
          x: base.x,
          y: base.y + applied,
          width: base.width,
          height: base.height,
          top: base.top + applied,
          right: base.right,
          bottom: base.bottom + applied,
          left: base.left,
          toJSON: () => ({}),
        };
      };
      toast.getBoundingClientRect = () => box(height, height);
      placeToast(host);
      expect(host.style.top).toBe(`${String(safe + 8)}px`);
      expect(toast.style.maxHeight).toBe("");
      expect(toast.style.overflow).not.toBe("hidden");
      expect(surface.dataset.toastPad).toBe(String(safe));
      sheet.remove();
      host.remove();
    }
  });

  it("keeps a 59px refusal and a two-line toast intact under a 47px safe area", () => {
    document.documentElement.style.setProperty("--safe-top", "47px");
    const sheet = document.createElement("div");
    sheet.setAttribute("data-vaul-drawer", "");
    sheet.setAttribute("data-state", "open");
    sheet.className = "ui-sheet-tall";
    const surface = document.createElement("div");
    surface.className = "ui-sheet-surface";
    const header = document.createElement("div");
    header.className = "ui-sheet-head";
    const close = document.createElement("button");
    close.setAttribute("aria-label", "סגירה");
    header.appendChild(close);
    surface.appendChild(header);
    sheet.appendChild(surface);
    const host = document.createElement("div");
    const toast = document.createElement("div");
    toast.className = "ui-toast";
    toast.textContent = "לא נשמר. בדקו את הפרטים ונסו שוב.";
    const retry = document.createElement("button");
    retry.textContent = "ניסיון חוזר";
    toast.appendChild(retry);
    host.appendChild(toast);
    document.body.append(sheet, host);
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 693 });
    // Sheet top 56. The toast keeps an 8px gap under the 47px safe area, so it sits at 55.
    sheet.getBoundingClientRect = () => box(456, 400);
    header.getBoundingClientRect = () => box(120, 64);
    const closeTop = 66;
    close.getBoundingClientRect = () => {
      const applied = Number.parseFloat(surface.dataset.toastPad ?? "") || 0;
      const base = box(110, 44);
      return {
        x: base.x,
        y: base.y + applied,
        width: base.width,
        height: base.height,
        top: base.top + applied,
        right: base.right,
        bottom: base.bottom + applied,
        left: base.left,
        toJSON: () => ({}),
      };
    };
    toast.getBoundingClientRect = () => box(59, 59);
    placeToast(host);
    expect(host.style.top).toBe("55px");
    expect(toast.style.maxHeight).toBe("");
    expect(toast.style.overflow).not.toBe("hidden");
    expect(toast.textContent).toContain("לא נשמר");
    expect(toast.textContent).toContain("ניסיון חוזר");
    const pad = Number.parseFloat(surface.dataset.toastPad ?? "");
    expect(pad).toBeGreaterThan(0);
    expect(surface.style.getPropertyValue("--toast-pad")).toBe(`${String(pad)}px`);
    expect(closeTop + pad).toBeGreaterThanOrEqual(55 + 59);
    placeToast(host);
    expect(surface.dataset.toastPad).toBe(String(pad));
    expect(host.style.top).toBe("55px");

    toast.getBoundingClientRect = () => box(toastMinBlock() + 8, toastMinBlock() + 8);
    placeToast(host);
    expect(toast.style.maxHeight).toBe("");
    expect(toast.style.overflow).not.toBe("hidden");
    expect(Number.parseFloat(host.style.top)).toBe(55);
    const grown = Number.parseFloat(surface.dataset.toastPad ?? "");
    expect(closeTop + grown).toBeGreaterThanOrEqual(55 + toastMinBlock() + 8);
    placeToast(host);
    expect(surface.dataset.toastPad).toBe(String(grown));
    sheet.remove();
    host.remove();
  });

  it("ignores a scrolled header and does not pad when ✕ is already clear", () => {
    document.documentElement.style.setProperty("--safe-top", "0px");
    const sheet = document.createElement("div");
    sheet.setAttribute("data-vaul-drawer", "");
    sheet.setAttribute("data-state", "open");
    sheet.className = "ui-sheet-tall";
    Object.defineProperty(sheet, "scrollTop", { configurable: true, writable: true, value: 196 });
    const surface = document.createElement("div");
    surface.className = "ui-sheet-surface";
    const close = document.createElement("button");
    close.setAttribute("aria-label", "סגירה");
    surface.appendChild(close);
    sheet.appendChild(surface);
    const host = document.createElement("div");
    const toast = document.createElement("div");
    toast.className = "ui-toast";
    host.appendChild(toast);
    document.body.append(sheet, host);
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    sheet.getBoundingClientRect = () => box(844, 788);
    // Scrolled up into the toast. Pinning the scroll puts ✕ back below it.
    close.getBoundingClientRect = () => box(64, 44);
    toast.getBoundingClientRect = () => box(54.5, 46.5);
    placeToast(host);
    expect(host.style.top).toBe("8px");
    expect(surface.dataset.toastPad).toBeUndefined();
    expect(surface.style.getPropertyValue("--toast-pad")).toBe("");
    sheet.remove();
    host.remove();
  });

  it("places a short sheet from the top it will have once the pad is gone", () => {
    const sheet = document.createElement("div");
    sheet.setAttribute("data-vaul-drawer", "");
    sheet.setAttribute("data-state", "open");
    sheet.className = "ui-sheet-fit";
    const surface = document.createElement("div");
    surface.className = "ui-sheet-surface";
    surface.style.setProperty("--toast-pad", "16.5px");
    const close = document.createElement("button");
    sheet.append(surface, close);
    const host = document.createElement("div");
    const toast = document.createElement("div");
    toast.className = "ui-toast";
    host.appendChild(toast);
    document.body.append(sheet, host);
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    // Visual top is 16.5px high because the pad is still lifting a fit sheet.
    sheet.getBoundingClientRect = () => box(844, 319.6875);
    close.getBoundingClientRect = () => box(622, 44);
    toast.getBoundingClientRect = () => box(46.5, 46.5);
    placeToast(host);
    expect(host.style.top).toBe("486.3125px");
    expect(surface.style.getPropertyValue("--toast-pad")).toBe("0px");
    sheet.remove();
    host.remove();
  });

  it("sits fully above a short sheet instead of across its top edge", () => {
    const sheet = document.createElement("div");
    sheet.setAttribute("data-vaul-drawer", "");
    sheet.setAttribute("data-state", "open");
    const header = document.createElement("div");
    header.className = "ui-sheet-head";
    const close = document.createElement("button");
    sheet.append(header, close);
    const host = document.createElement("div");
    const toast = document.createElement("div");
    toast.className = "ui-toast";
    host.appendChild(toast);
    document.body.append(sheet, host);
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    sheet.getBoundingClientRect = () => box(700, 300);
    header.getBoundingClientRect = () => box(460, 40);
    close.getBoundingClientRect = () => box(500, 44);
    toast.getBoundingClientRect = () => box(48, 48);
    placeToast(host);
    expect(host.style.top).toBe("344px");
    const top = Number.parseFloat(host.style.top);
    expect(top + 48).toBeLessThanOrEqual(400);
    sheet.remove();
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

  it("sits under the header when the only other slot covers the tab bar", () => {
    const header = document.createElement("header");
    header.className = "ui-page";
    const link = document.createElement("a");
    link.href = "/review/all";
    const line = document.createElement("button");
    const approve = document.createElement("button");
    const bar = document.createElement("nav");
    bar.className = "ui-tabbar";
    const tab = document.createElement("a");
    tab.href = "/review";
    bar.appendChild(tab);
    const host = document.createElement("div");
    const toast = document.createElement("div");
    toast.className = "ui-toast";
    host.appendChild(toast);
    document.body.append(header, link, line, approve, bar, host);
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    header.getBoundingClientRect = () => box(56, 56);
    link.getBoundingClientRect = () => box(112, 44);
    line.getBoundingClientRect = () => box(680, 560);
    approve.getBoundingClientRect = () => box(731, 44);
    bar.getBoundingClientRect = () => box(844, 60);
    tab.getBoundingClientRect = () => box(828, 44);
    toast.getBoundingClientRect = () => box(46, 46);
    placeToast(host);
    const top = Number.parseFloat(host.style.top);
    expect(top + 46).toBeLessThanOrEqual(784);
    expect(top).toBeLessThan(120);
    header.remove();
    link.remove();
    line.remove();
    approve.remove();
    bar.remove();
    host.remove();
  });
});