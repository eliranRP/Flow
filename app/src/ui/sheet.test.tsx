import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useLayoutEffect, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { machineProblems } from "@flow/shared";
import { SHEET_CLOSE_SETTLE_MS, Sheet, SheetSurface, sheetClose } from "./sheet";
import { expectRtl, expectTarget } from "./test-support";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import { sheetStack, useSheetHistory } from "./back";

// --- sheet.test.tsx

describe("Sheet", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens a dialog with a 44px close control", () => {
    expectRtl();
    render(
      <Sheet open onOpenChange={() => undefined} title="תקופה">
        <p>תוכן</p>
      </Sheet>,
    );
    expect(screen.getByRole("dialog", { name: "תקופה" })).toBeInTheDocument();
    expectTarget(screen.getByRole("button", { name: "סגירה" }));
    render(
      <SheetSurface title="תצוגה">
        <p>פאנל</p>
      </SheetSurface>,
    );
    expect(screen.getByRole("heading", { name: "תצוגה" })).toBeInTheDocument();
    expect(document.querySelector("[title]")).toBeNull();
  });

  it("draws no outline on an opened sheet panel", () => {
    render(
      <Sheet open onOpenChange={() => undefined} title="תקופה">
        <button type="button">בפנים</button>
      </Sheet>,
    );
    const panel = screen.getByRole("dialog", { name: "תקופה" });
    expect(panel).toHaveClass("ui-sheet-panel");
    panel.focus();
    expect(getComputedStyle(panel).outlineStyle).toBe("none");
    expect(sheetFocusRule()).toBe("none");
    expect(screen.getByRole("button", { name: "בפנים" })).toBeInTheDocument();
  });

  it("notifies a close once, and the panel is inert while it closes", async () => {
    vi.useFakeTimers();
    let closed = 0;
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <Sheet open={open} onOpenChange={setOpen} onClosed={() => { closed += 1; }} title="תקופה">
          <p>תוכן</p>
        </Sheet>
      );
    }
    render(<Harness />);
    const panel = screen.getByRole("dialog", { name: "תקופה" });
    expect(panel).not.toHaveAttribute("inert");
    fireEvent.keyDown(document, { key: "Escape" });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const sliding = screen.queryByRole("dialog", { name: "תקופה" });
    if (sliding) expect(sliding).toHaveAttribute("inert");
    expect(closed).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(220); });
    expect(closed).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(closed).toBe(1);
  });

  it("sets the title on the sheet role (20/600), not the name role", () => {
    render(
      <Sheet open onOpenChange={() => undefined} title="תקופה">
        <p>תוכן</p>
      </Sheet>,
    );
    expect(screen.getByRole("heading", { name: "תקופה" })).toHaveClass("t-sheet");
    expect(screen.getByRole("heading", { name: "תקופה" })).not.toHaveClass("t-name");
  });

  it("sizes the tall sheet with the visual viewport variable", () => {
    expect(tallSheetHeightRule()).toContain("var(--vvh");
  });
});

describe("Sheet while a save is in flight (FLOW-363 3b)", () => {
  const tick = () => act(async () => { await Promise.resolve(); });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("has no ✕ and marks the dialog busy; a closed sheet shows ✕ again", () => {
    const { rerender } = render(
      <Sheet open busy onOpenChange={() => undefined} title="תקופה">
        <p>תוכן</p>
      </Sheet>,
    );
    expect(screen.getByRole("dialog", { name: "תקופה" })).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("button", { name: "סגירה" })).toBeNull();
    rerender(
      <Sheet open onOpenChange={() => undefined} title="תקופה">
        <p>תוכן</p>
      </Sheet>,
    );
    expect(screen.getByRole("dialog", { name: "תקופה" })).not.toHaveAttribute("aria-busy");
    expect(screen.getByRole("button", { name: "סגירה" })).toBeInTheDocument();
  });

  it("keeps a busy sheet open on Escape and a scrim tap, then closes it once when the save settles", async () => {
    const onOpenChange = vi.fn();
    const sheet = (busy: boolean) => (
      <Sheet open busy={busy} onOpenChange={onOpenChange} title="תקופה">
        <p>תוכן</p>
      </Sheet>
    );
    const { rerender } = render(sheet(true));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    fireEvent.keyDown(document, { key: "Escape" });
    await tick();
    fireEvent.pointerDown(document.querySelector(".ui-sheet-scrim") ?? document.body);
    await tick();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "תקופה" })).toBeInTheDocument();
    rerender(sheet(false));
    await waitFor(() => { expect(onOpenChange).toHaveBeenCalledWith(false); });
    await tick();
    expect(onOpenChange).toHaveBeenCalledTimes(1);
  });

  it("leaves a sheet open when onBeforeClose refuses, and the next accepted ✕ closes it", async () => {
    const veto = { current: true };
    const onOpenChange = vi.fn();
    render(
      <Sheet open onOpenChange={onOpenChange} title="תקופה" onBeforeClose={() => (veto.current ? false : undefined)}>
        <p>תוכן</p>
      </Sheet>,
    );
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    await tick();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "תקופה" })).toBeInTheDocument();
    veto.current = false;
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    await waitFor(() => { expect(onOpenChange).toHaveBeenCalledWith(false); });
    expect(onOpenChange).toHaveBeenCalledTimes(1);
  });

  it("closes once when a dismiss and the success close both land during a save", async () => {
    const onOpenChange = vi.fn();
    const onCloseKind = vi.fn();
    const requestClose: { current: (() => void) | null } = { current: null };
    const sheet = (busy: boolean) => (
      <Sheet
        open
        busy={busy}
        onOpenChange={onOpenChange}
        onCloseKind={onCloseKind}
        onRequestClose={requestClose}
        title="תקופה"
      >
        <p>תוכן</p>
      </Sheet>
    );
    const { rerender } = render(sheet(true));
    await tick();
    fireEvent.keyDown(document, { key: "Escape" });
    await tick();
    act(() => { requestClose.current?.(); });
    await tick();
    expect(onOpenChange).not.toHaveBeenCalled();
    rerender(sheet(false));
    await waitFor(() => { expect(onOpenChange).toHaveBeenCalledWith(false); });
    await tick();
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onCloseKind).toHaveBeenCalledTimes(1);
    expect(onCloseKind).toHaveBeenCalledWith(true);
  });

  it("reports an Escape held through a save as a key close once the save clears", async () => {
    const onOpenChange = vi.fn();
    const onCloseKind = vi.fn();
    const sheet = (busy: boolean) => (
      <Sheet open busy={busy} onOpenChange={onOpenChange} onCloseKind={onCloseKind} title="תקופה">
        <p>תוכן</p>
      </Sheet>
    );
    const { rerender } = render(sheet(true));
    await tick();
    fireEvent.keyDown(document, { key: "Escape" });
    await tick();
    expect(onCloseKind).not.toHaveBeenCalled();
    rerender(sheet(false));
    await waitFor(() => { expect(onCloseKind).toHaveBeenCalledWith(true); });
    expect(onCloseKind).toHaveBeenCalledTimes(1);
    await waitFor(() => { expect(onOpenChange).toHaveBeenCalledWith(false); });
  });

  // FLOW-1167: the close is one table (`sheetClose`).
  it("has a sound close table that ignores a move out of order", () => {
    expect(machineProblems(sheetClose)).toEqual([]);
    expect(sheetClose.next("closed", "request")).toBe("closed");
    expect(sheetClose.next("open", "allow")).toBe("open");
    expect(sheetClose.next("deciding", "request")).toBe("deciding");
    expect(sheetClose.next("closing", "request")).toBe("closing");
    // A render does not move a close the parent accepted; only a late tap (`retry`) or the parent does.
    expect(sheetClose.next("closing", "shown")).toBe("closing");
    expect(sheetClose.next("closing", "retry")).toBe("deciding");
    expect(sheetClose.next("open", "retry")).toBe("open");
  });

  it("hears a close after the window when the parent ignored an accepted one; two taps in a tick send one", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    const onBeforeClose = vi.fn(() => undefined);
    const onOpenChange = vi.fn();
    render(<Sheet open onOpenChange={onOpenChange} onBeforeClose={onBeforeClose} title="תקופה"><p>תוכן</p></Sheet>);
    const close = screen.getByRole("button", { name: "סגירה" });
    fireEvent.click(close);
    fireEvent.click(close);
    await tick();
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    // Inside the window the parent may still be closing (a history pop): the ✕ is the same close.
    vi.setSystemTime(1_000_000 + SHEET_CLOSE_SETTLE_MS - 1);
    fireEvent.click(close);
    await tick();
    expect(onBeforeClose).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    // After it, the parent ignored the close: the ✕ is a fresh request and asks again.
    vi.setSystemTime(1_000_000 + SHEET_CLOSE_SETTLE_MS);
    fireEvent.click(close);
    await tick();
    expect(onBeforeClose).toHaveBeenCalledTimes(2);
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });

  it("closes once for an async parent however many taps land before it closes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const onBeforeClose = vi.fn(() => undefined);
    const onCloseKind = vi.fn();
    const onOpenChange = vi.fn();
    function Late() {
      const [open, setOpen] = useState(true);
      return (
        <Sheet
          open={open}
          onOpenChange={(next) => { onOpenChange(next); window.setTimeout(() => { setOpen(next); }, 30); }}
          onBeforeClose={onBeforeClose}
          onCloseKind={onCloseKind}
          title="תקופה"
        >
          <p>תוכן</p>
        </Sheet>
      );
    }
    render(<Late />);
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    await tick();
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "תקופה" })).toBeNull(); });
    expect(onBeforeClose).toHaveBeenCalledTimes(1);
    expect(onCloseKind).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledTimes(1);
  });

  it("hears a programmatic close in the same commit that opens the sheet", async () => {
    const onOpenChange = vi.fn();
    function SameTick() {
      const [open, setOpen] = useState(false);
      const requestClose = useRef<(() => void) | null>(null);
      useLayoutEffect(() => {
        if (open) requestClose.current?.();
      }, [open]);
      return (
        <>
          <button type="button" onClick={() => { setOpen(true); }}>פתיחה</button>
          <Sheet open={open} onOpenChange={(next) => { onOpenChange(next); setOpen(next); }} onRequestClose={requestClose} title="תקופה">
            <p>תוכן</p>
          </Sheet>
        </>
      );
    }
    render(<SameTick />);
    fireEvent.click(screen.getByRole("button", { name: "פתיחה" }));
    await tick();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("sends nothing for a decision that settles after the sheet unmounted", async () => {
    let decide: (verdict: undefined) => void = () => undefined;
    const onCloseKind = vi.fn();
    const onOpenChange = vi.fn();
    const { unmount } = render(
      <Sheet open onOpenChange={onOpenChange} onCloseKind={onCloseKind} title="תקופה" onBeforeClose={() => new Promise<undefined>((resolve) => { decide = resolve; })}>
        <p>תוכן</p>
      </Sheet>,
    );
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    await tick();
    unmount();
    await act(async () => { decide(undefined); await Promise.resolve(); });
    expect(onCloseKind).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("drops a decision that lands after the parent closed the sheet", async () => {
    let decide: (verdict: undefined) => void = () => undefined;
    const onOpenChange = vi.fn();
    const sheet = (open: boolean) => (
      <Sheet open={open} onOpenChange={onOpenChange} title="תקופה" onBeforeClose={() => new Promise<undefined>((resolve) => { decide = resolve; })}>
        <p>תוכן</p>
      </Sheet>
    );
    const { rerender } = render(sheet(true));
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    await tick();
    rerender(sheet(false));
    await act(async () => { decide(undefined); await Promise.resolve(); });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("keeps a decision that never settles: later closes are not asked again until the parent closes or reopens the sheet", async () => {
    const onBeforeClose = vi.fn(() => new Promise<undefined>(() => undefined));
    const onOpenChange = vi.fn();
    const sheet = (open: boolean) => (
      <Sheet open={open} onOpenChange={onOpenChange} title="תקופה" onBeforeClose={onBeforeClose}>
        <p>תוכן</p>
      </Sheet>
    );
    const { rerender } = render(sheet(true));
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    await tick();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    await tick();
    expect(onBeforeClose).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "תקופה" })).toBeInTheDocument();
    // The parent's own close always wins, and a reopened sheet asks afresh.
    rerender(sheet(false));
    rerender(sheet(true));
    await waitFor(() => { expect(screen.getByRole("button", { name: "סגירה" })).toBeInTheDocument(); });
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    await tick();
    expect(onBeforeClose).toHaveBeenCalledTimes(2);
  });
});

function tallSheetHeightRule(): string {
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of rules) {
      if (!(rule instanceof CSSStyleRule)) continue;
      if (rule.selectorText !== "[data-vaul-drawer].ui-sheet-panel.ui-sheet-tall") continue;
      return rule.style.getPropertyValue("height");
    }
  }
  return "";
}

function sheetFocusRule(): string {
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of rules) {
      if (!(rule instanceof CSSStyleRule)) continue;
      if (rule.selectorText.includes(".ui-sheet-panel:focus-visible")) return rule.style.outline;
    }
  }
  return "";
}

function ReturnHarness({ onEscape, veto, lateClose = false }: { onEscape?: () => void; veto?: { current: boolean }; lateClose?: boolean }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" ref={opener} onClick={() => { setOpen(true); }}>ניתוק</button>
      <Sheet
        open={open}
        onOpenChange={lateClose ? (next) => { window.setTimeout(() => { setOpen(next); }, 0); } : setOpen}
        title="לנתק?"
        returnFocusRef={opener}
        onEscape={onEscape}
        onBeforeClose={veto ? () => (veto.current ? false : undefined) : undefined}
      >
        <p>תוכן</p>
      </Sheet>
    </>
  );
}

describe("Sheet focus return (FLOW-310)", () => {
  it("returns focus to the opener after Escape and marks its ring until it blurs", async () => {
    render(<ReturnHarness />);
    fireEvent.click(screen.getByRole("button", { name: "ניתוק" }));
    fireEvent.keyDown(screen.getByRole("dialog", { name: "לנתק?" }), { key: "Escape" });
    const opener = screen.getByRole("button", { name: "ניתוק", hidden: true });
    await waitFor(() => { expect(opener).toHaveFocus(); });
    expect(opener).toHaveAttribute("data-focus-ring");
    act(() => { opener.blur(); });
    expect(opener).not.toHaveAttribute("data-focus-ring");
  });

  it("keeps the Escape ring when the parent closes a moment later", async () => {
    render(<ReturnHarness lateClose />);
    fireEvent.click(screen.getByRole("button", { name: "ניתוק" }));
    fireEvent.keyDown(screen.getByRole("dialog", { name: "לנתק?" }), { key: "Escape" });
    const opener = screen.getByRole("button", { name: "ניתוק", hidden: true });
    await waitFor(() => { expect(opener).toHaveFocus(); });
    expect(opener).toHaveAttribute("data-focus-ring");
  });

  it("returns focus after ✕ with no forced ring", async () => {
    render(<ReturnHarness />);
    fireEvent.click(screen.getByRole("button", { name: "ניתוק" }));
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    const opener = screen.getByRole("button", { name: "ניתוק", hidden: true });
    await waitFor(() => { expect(opener).toHaveFocus(); });
    expect(opener).not.toHaveAttribute("data-focus-ring");
  });

  it("gives no ring to a later ✕ after an Escape the sheet handled itself", async () => {
    render(<ReturnHarness onEscape={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "ניתוק" }));
    fireEvent.keyDown(screen.getByRole("dialog", { name: "לנתק?" }), { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "לנתק?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    const opener = screen.getByRole("button", { name: "ניתוק", hidden: true });
    await waitFor(() => { expect(opener).toHaveFocus(); });
    expect(opener).not.toHaveAttribute("data-focus-ring");
  });

  it("gives no ring to a later ✕ after an Escape that onBeforeClose refused", async () => {
    const veto = { current: true };
    render(<ReturnHarness veto={veto} />);
    fireEvent.click(screen.getByRole("button", { name: "ניתוק" }));
    fireEvent.keyDown(screen.getByRole("dialog", { name: "לנתק?" }), { key: "Escape" });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("dialog", { name: "לנתק?" })).toBeInTheDocument();
    veto.current = false;
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    const opener = screen.getByRole("button", { name: "ניתוק", hidden: true });
    await waitFor(() => { expect(opener).toHaveFocus(); });
    expect(opener).not.toHaveAttribute("data-focus-ring");
  });
});
// --- sheet-close.test.tsx

function Place() {
  const location = useLocation();
  const layer = sheetStack(location.state).join("+");
  return <p>{`${location.pathname}|${location.key}|${layer}`}</p>;
}

function SheetProbe() {
  const [open, setOpen] = useState(false);
  const setSheet = useSheetHistory("sumit-connect", open, setOpen);
  return (
    <>
      <Place />
      <button type="button" onClick={() => { setSheet(true); }}>פתיחה</button>
      <button type="button" onClick={() => { setSheet(false); }}>סגירה</button>
      <button
        type="button"
        onClick={() => {
          setSheet(false);
          setSheet(false);
        }}
      >
        סגירה כפולה
      </button>
      <p>{open ? "פתוח" : "סגור"}</p>
    </>
  );
}

function renderProbe() {
  const router = createMemoryRouter(
    [
      { path: "/", element: <h1>בית</h1> },
      { path: "/settings", element: <SheetProbe /> },
    ],
    { initialEntries: ["/", "/settings"], initialIndex: 1 },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe("sheet close history", () => {
  afterEach(() => {
    window.history.replaceState(null, "");
  });

  it("pops once when the sheet is closed twice before popstate", async () => {
    const router = renderProbe();
    const settingsKey = router.state.location.key;
    window.history.replaceState({ idx: 1 }, "");
    fireEvent.click(screen.getByRole("button", { name: "פתיחה" }));
    await waitFor(() => {
      expect(router.state.location.state).toMatchObject({ flowLayer: "sumit-connect" });
    });
    window.history.replaceState({ idx: 2 }, "");
    fireEvent.click(screen.getByRole("button", { name: "סגירה כפולה" }));
    await waitFor(() => {
      expect(router.state.navigation.state).toBe("idle");
      expect(router.state.location.pathname).toBe("/settings");
      expect(router.state.location.key).toBe(settingsKey);
    });
    expect(sheetStack(router.state.location.state)).toEqual([]);
  });

  it("pops again after the sheet is opened a second time", async () => {
    const router = renderProbe();
    const settingsKey = router.state.location.key;
    window.history.replaceState({ idx: 1 }, "");
    fireEvent.click(screen.getByRole("button", { name: "פתיחה" }));
    await waitFor(() => {
      expect(router.state.location.state).toMatchObject({ flowLayer: "sumit-connect" });
    });
    window.history.replaceState({ idx: 2 }, "");
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    await waitFor(() => {
      expect(router.state.location.key).toBe(settingsKey);
    });
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() => {
      expect(screen.getByText("סגור")).toBeInTheDocument();
    });
    window.history.replaceState({ idx: 1 }, "");
    fireEvent.click(screen.getByRole("button", { name: "פתיחה" }));
    await waitFor(() => {
      expect(router.state.location.state).toMatchObject({ flowLayer: "sumit-connect" });
      expect(router.state.location.key).not.toBe(settingsKey);
    });
    window.history.replaceState({ idx: 2 }, "");
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    await waitFor(() => {
      expect(router.state.navigation.state).toBe("idle");
      expect(router.state.location.pathname).toBe("/settings");
      expect(router.state.location.key).toBe(settingsKey);
    });
  });
});

function HistorySheet({ onBeforeClose }: { onBeforeClose: () => undefined }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const setSheet = useSheetHistory("history-sheet", open, setOpen);
  return (
    <>
      <button type="button" ref={opener} onClick={() => { setSheet(true); }}>בחירה</button>
      <Sheet open={open} onOpenChange={setSheet} title="בחירה" returnFocusRef={opener} onBeforeClose={onBeforeClose}>
        <p>תוכן</p>
      </Sheet>
    </>
  );
}

describe("Sheet closed by a history pop (useSheetHistory)", () => {
  afterEach(() => {
    window.history.replaceState(null, "");
  });

  it("closes once for taps before the pop lands, and keeps the Escape ring", async () => {
    const onBeforeClose = vi.fn(() => undefined);
    const router = createMemoryRouter(
      [
        { path: "/", element: <h1>בית</h1> },
        { path: "/settings", element: <HistorySheet onBeforeClose={onBeforeClose} /> },
      ],
      { initialEntries: ["/", "/settings"], initialIndex: 1 },
    );
    render(<RouterProvider router={router} />);
    const settingsKey = router.state.location.key;
    window.history.replaceState({ idx: 1 }, "");
    fireEvent.click(screen.getByRole("button", { name: "בחירה" }));
    await waitFor(() => {
      expect(router.state.location.state).toMatchObject({ flowLayer: "history-sheet" });
    });
    window.history.replaceState({ idx: 2 }, "");
    fireEvent.keyDown(screen.getByRole("dialog", { name: "בחירה" }), { key: "Escape" });
    await waitFor(() => { expect(router.state.location.key).toBe(settingsKey); });
    // The pop has not reached the sheet yet: it is still drawn open, and a ✕ is the same close.
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    await act(async () => { await Promise.resolve(); });
    expect(onBeforeClose).toHaveBeenCalledTimes(1);
    expect(router.state.location.key).toBe(settingsKey);
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    const opener = screen.getByRole("button", { name: "בחירה", hidden: true });
    await waitFor(() => { expect(opener).toHaveFocus(); });
    expect(opener).toHaveAttribute("data-focus-ring");
    expect(router.state.location.pathname).toBe("/settings");
  });
});