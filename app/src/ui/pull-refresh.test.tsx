import { QueryClient, useQuery, type QueryClient as Client } from "@tanstack/react-query";
import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test-render";
import { invokeEdge } from "../edge";
import { PULL_CAP_MS, PULL_FAILED, PULL_REST_PX, PULL_SPOKES, PULL_THRESHOLD_PX, pullArmed, pullMove, PullRefresh, pullSpokes, pullTone, pullTravel } from "./pull-refresh";

vi.mock("../edge", async (original) => ({ ...(await original<typeof import("../edge")>()), invokeEdge: vi.fn() }));

const WIDTH = 390;
type Point = { identifier: number; clientX: number; clientY: number };

function fire(type: string, target: EventTarget, list: Point[]) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { value: list });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/** A one-finger drag from (x, 200) by dx and dy in 4 steps, still held; returns the last move. */
function drag(target: EventTarget, dy: number, { x = 200, dx = 0 } = {}) {
  const at = (step: number): Point[] => [{ identifier: 1, clientX: x + (dx * step) / 4, clientY: 200 + (dy * step) / 4 }];
  fire("touchstart", target, at(0));
  let last: Event = new Event("touchmove");
  for (let step = 1; step <= 4; step += 1) last = fire("touchmove", target, at(step));
  return last;
}

/** The same drag, let go. */
function pull(target: EventTarget, dy: number, options: { x?: number; dx?: number } = {}) {
  const last = drag(target, dy, options);
  fire("touchend", target, []);
  return last;
}

function Reads({ read }: { read: () => Promise<string> }) {
  const query = useQuery({ queryKey: ["pull-test"], queryFn: read });
  return <p>{query.data ?? "…"}</p>;
}

function renderPull(read: () => Promise<string> = () => Promise.resolve("נתונים"), extra: React.ReactNode = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const refetch = vi.spyOn(client, "invalidateQueries");
  renderWithProviders(
    <PullRefresh>
      <Reads read={read} />
      {extra}
    </PullRefresh>,
    { client },
  );
  return { client, refetch };
}

function pulledScreen() {
  return document.querySelector<HTMLElement>(".ui-pull-screen");
}

function spokes() {
  return Array.from(document.querySelectorAll(".ui-pull-spinner > line"));
}

function shownSpokes() {
  return spokes().filter((line) => line.getAttribute("opacity") === "1").length;
}

function px(value: string | undefined) {
  return Number.parseFloat(value ?? "");
}

function status() {
  return screen.getAllByRole("status").find((node) => node.classList.contains("sr-only"));
}

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: WIDTH });
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  document.documentElement.dataset.pullRefresh = "on";
});

afterEach(() => {
  delete document.documentElement.dataset.pullRefresh;
  Reflect.deleteProperty(navigator, "vibrate");
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(invokeEdge).mockClear();
});

/** jsdom lays nothing out, so every element has no boxes; a drawn band has one. */
function drawn() {
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
}

describe("pull travel", () => {
  it("is zero for no move and for an upward one", () => {
    expect(pullTravel(-30)).toBe(0);
    expect(pullTravel(0)).toBe(0);
  });

  it("follows the finger about 1:1 at first", () => {
    expect(pullTravel(1)).toBeCloseTo(0.98, 2);
    expect(pullTravel(8) / 8).toBeCloseTo(0.86, 2);
    expect(pullTravel(20) / 20).toBeGreaterThan(0.75);
  });

  it("rises with every move, at a falling rate", () => {
    let last = 0;
    let step = Infinity;
    for (let move = 10; move <= 2000; move += 10) {
      const travel = pullTravel(move);
      expect(travel).toBeGreaterThan(last);
      expect(travel - last).toBeLessThan(step);
      step = travel - last;
      last = travel;
    }
  });

  it("reaches the threshold at about 110px of move, 120px with the 10px decision", () => {
    expect(pullMove(PULL_THRESHOLD_PX)).toBeCloseTo(110, 0);
    expect(pullArmed(pullTravel(105))).toBe(false);
    expect(pullArmed(pullTravel(111))).toBe(true);
  });

  it("reaches about 155px at 290px of move, and has no cap", () => {
    expect(pullTravel(290)).toBeCloseTo(155, 0);
    expect(pullTravel(4000)).toBeGreaterThan(pullTravel(2000) + 900);
  });

  it("turns a travel back into its move", () => {
    for (const travel of [0, 10, 40, 64, 120, 155, 600]) expect(pullTravel(pullMove(travel))).toBeCloseTo(travel, 6);
  });

  it("arms at 64px of travel", () => {
    expect(pullArmed(63)).toBe(false);
    expect(pullArmed(64)).toBe(true);
  });

  it("shows a spoke per twelfth of the way to the threshold", () => {
    expect(pullSpokes(0)).toBe(0);
    expect(pullSpokes(2)).toBe(0);
    expect(pullSpokes(PULL_THRESHOLD_PX / 4)).toBe(3);
    expect(pullSpokes(PULL_THRESHOLD_PX / 2)).toBe(6);
    expect(pullSpokes(PULL_THRESHOLD_PX - 3)).toBe(PULL_SPOKES - 1);
    expect(pullSpokes(PULL_THRESHOLD_PX)).toBe(PULL_SPOKES);
    expect(pullSpokes(300)).toBe(PULL_SPOKES);
  });
});

describe("PullRefresh", () => {
  it("refreshes once past the threshold, spins until the reads settle, then collapses", async () => {
    const { refetch } = renderPull();
    await screen.findByText("נתונים");
    const move = pull(document.body, 200);
    expect(move.defaultPrevented).toBe(true);
    expect(refetch).toHaveBeenCalledTimes(1);
    // Every cached read, and nothing else: a pull reads Flow's own server, no bank sync.
    expect(refetch).toHaveBeenCalledWith();
    expect(invokeEdge).not.toHaveBeenCalled();
    expect(pulledScreen()).toHaveAttribute("data-phase", "refreshing");
    expect(pulledScreen()?.style.getPropertyValue("--pull-y")).toBe(`${String(PULL_REST_PX)}px`);
    expect(status()).toHaveTextContent("מרענן");
    expect(spokes()).toHaveLength(PULL_SPOKES);
    // Turning, the spokes fade round from the head.
    expect(spokes().map((line) => Number(line.getAttribute("opacity")))[0]).toBe(1);
    expect(Math.min(...spokes().map((line) => Number(line.getAttribute("opacity"))))).toBeCloseTo(0.25);
    await waitFor(() => { expect(status()).toHaveTextContent(""); });
    expect(pulledScreen()).toHaveAttribute("data-phase", "returning");
    await waitFor(() => { expect(document.querySelector(".ui-pull-refresh")).toBeNull(); });
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(invokeEdge).not.toHaveBeenCalled();
    expect(pulledScreen()).not.toHaveAttribute("data-phase");
    expect(document.querySelector(".ui-pull-gap")).toBeNull();
  });

  it("brings the screen down with the finger from where the pull is decided, over a gap in the page colour", async () => {
    renderPull();
    await screen.findByText("נתונים");
    // 4 moves of 20px: the first decides the pull, so the move counts 60px from there.
    drag(document.body, 80);
    expect(pulledScreen()).toHaveAttribute("data-phase", "pulling");
    expect(pulledScreen()?.style.getPropertyValue("--pull-y")).toBe(`${String(pullTravel(60))}px`);
    expect(document.querySelector(".ui-pull-gap")).toHaveAttribute("data-tone", "page");
    expect(shownSpokes()).toBe(pullSpokes(pullTravel(60)));
    fire("touchend", document.body, []);
  });

  it("ticks once when the pull crosses the threshold, and not again", async () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    renderPull();
    await screen.findByText("נתונים");
    const at = (y: number): Point[] => [{ identifier: 1, clientX: 200, clientY: y }];
    fire("touchstart", document.body, at(200));
    fire("touchmove", document.body, at(220));
    fire("touchmove", document.body, at(300));
    expect(vibrate).not.toHaveBeenCalled();
    fire("touchmove", document.body, at(340));
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith(10);
    fire("touchmove", document.body, at(260));
    fire("touchmove", document.body, at(360));
    expect(vibrate).toHaveBeenCalledTimes(1);
    fire("touchcancel", document.body, []);
  });

  it("pulls with no haptic where the platform has none", async () => {
    renderPull();
    await screen.findByText("נתונים");
    expect("vibrate" in navigator).toBe(false);
    drag(document.body, 300);
    expect(pulledScreen()).toHaveAttribute("data-phase", "pulling");
    fire("touchend", document.body, []);
  });

  it("catches a returning screen where it is, and pulls on from there", async () => {
    const { refetch } = renderPull();
    await screen.findByText("נתונים");
    pull(document.body, 80);
    expect(pulledScreen()).toHaveAttribute("data-phase", "closing");
    // Mid-glide the screen's live top is 30px (no safe area here).
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((node, pseudo) => {
      const style = real(node, pseudo);
      if (node === pulledScreen()) Object.defineProperty(style, "top", { value: "30px" });
      return style;
    });
    const at = (y: number): Point[] => [{ identifier: 2, clientX: 200, clientY: y }];
    fire("touchstart", document.body, at(400));
    expect(pulledScreen()).toHaveAttribute("data-phase", "pulling");
    expect(px(pulledScreen()?.style.getPropertyValue("--pull-y"))).toBeCloseTo(30, 6);
    // No 10px decision: the screen is held, and a move goes on from 30px.
    const move = fire("touchmove", document.body, at(405));
    expect(move.defaultPrevented).toBe(true);
    expect(px(pulledScreen()?.style.getPropertyValue("--pull-y"))).toBeCloseTo(pullTravel(pullMove(30) + 5), 6);
    fire("touchmove", document.body, at(560));
    fire("touchend", document.body, []);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(pulledScreen()).toHaveAttribute("data-phase", "refreshing");
  });

  it("lets a tap on a returning screen go on returning", async () => {
    renderPull();
    await screen.findByText("נתונים");
    pull(document.body, 80);
    fire("touchstart", document.body, [{ identifier: 2, clientX: 200, clientY: 400 }]);
    fire("touchend", document.body, []);
    expect(pulledScreen()).toHaveAttribute("data-phase", "closing");
    await waitFor(() => { expect(pulledScreen()).not.toHaveAttribute("data-phase"); });
  });

  it("fills the gap with the band's colour where the screen starts with the band", async () => {
    drawn();
    renderPull(undefined, <header className="ui-band" />);
    await screen.findByText("נתונים");
    drag(document.body, 80);
    expect(document.querySelector(".ui-pull-gap")).toHaveAttribute("data-tone", "band");
    fire("touchend", document.body, []);
  });

  it("reads the tone from the screen's top", () => {
    drawn();
    const box = document.createElement("div");
    expect(pullTone(box)).toBe("page");
    expect(pullTone(null)).toBe("page");
    const band = document.createElement("header");
    band.className = "ui-band ui-band-past";
    box.append(band);
    expect(pullTone(box)).toBe("band-past");
    band.className = "ui-band";
    expect(pullTone(box)).toBe("band");
    vi.spyOn(band, "getBoundingClientRect").mockReturnValue({ top: 120 } as DOMRect);
    expect(pullTone(box)).toBe("page");
  });

  it("takes the page colour when the band is not drawn", () => {
    const box = document.createElement("div");
    const band = document.createElement("header");
    band.className = "ui-band";
    box.append(band);
    // jsdom gives every element no boxes, as a browser does for display: none.
    expect(pullTone(box)).toBe("page");
  });

  it("ends the spinner at the cap when a read never settles, and a later pull works", async () => {
    let calls = 0;
    const { refetch } = renderPull(() => {
      calls += 1;
      return calls === 1 ? Promise.resolve("נתונים") : new Promise<string>(() => undefined);
    });
    await screen.findByText("נתונים");
    vi.useFakeTimers();
    pull(document.body, 200);
    expect(status()).toHaveTextContent("מרענן");
    await act(async () => { await vi.advanceTimersByTimeAsync(PULL_CAP_MS - 100); });
    expect(status()).toHaveTextContent("מרענן");
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(status()).toHaveTextContent("");
    expect(screen.queryByText(PULL_FAILED)).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(document.querySelector(".ui-pull-refresh")).toBeNull();
    pull(document.body, 200);
    expect(refetch).toHaveBeenCalledTimes(2);
    expect(status()).toHaveTextContent("מרענן");
  });

  it("marks every cached read stale, so a nested fresh read and another screen's read read again", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    let inner = 0;
    let outer = 0;
    // Another screen's read, fresh and not on screen.
    client.setQueryData(["other-screen"], "ישן");
    function Nested() {
      const query = useQuery({
        queryKey: ["outer"],
        queryFn: async ({ client: from }: { client: Client }) => {
          outer += 1;
          const value = await from.query({ queryKey: ["inner"], queryFn: () => Promise.resolve(`פנימי ${String(++inner)}`), staleTime: Infinity });
          return `${value} · ${String(outer)}`;
        },
      });
      return <p>{query.data ?? "…"}</p>;
    }
    renderWithProviders(<PullRefresh><Nested /></PullRefresh>, { client });
    expect(await screen.findByText("פנימי 1 · 1")).toBeInTheDocument();
    pull(document.body, 200);
    expect(await screen.findByText("פנימי 2 · 2")).toBeInTheDocument();
    expect(inner).toBe(2);
    expect(client.getQueryState(["other-screen"])?.isInvalidated).toBe(true);
  });

  it("springs back with nothing done when let go before the threshold", async () => {
    const { refetch } = renderPull();
    await screen.findByText("נתונים");
    pull(document.body, 80);
    expect(refetch).not.toHaveBeenCalled();
    expect(document.querySelector('.ui-pull-refresh[data-phase="closing"]')).not.toBeNull();
    // The spokes fade where they stood: the count from the release stays.
    expect(shownSpokes()).toBe(pullSpokes(pullTravel(60)));
    await waitFor(() => { expect(document.querySelector(".ui-pull-refresh")).toBeNull(); });
  });

  it("does not start when the page is scrolled down", async () => {
    const { refetch } = renderPull();
    await screen.findByText("נתונים");
    Object.defineProperty(window, "scrollY", { configurable: true, value: 120 });
    const move = pull(document.body, 200);
    expect(move.defaultPrevented).toBe(false);
    expect(refetch).not.toHaveBeenCalled();
    expect(document.querySelector(".ui-pull-refresh")).toBeNull();
  });

  it("does not start while a sheet is open", async () => {
    const { refetch } = renderPull(undefined, <div role="dialog" aria-label="גיליון" />);
    await screen.findByText("נתונים");
    pull(document.body, 200);
    expect(refetch).not.toHaveBeenCalled();
  });

  it("does not start inside an inner list scrolled down from its top", async () => {
    const { refetch } = renderPull(undefined, (
      <div data-testid="list" style={{ overflowY: "auto" }}>
        <p data-testid="row">שורה</p>
      </div>
    ));
    await screen.findByText("נתונים");
    const list = screen.getByTestId("list");
    list.scrollTop = 40;
    pull(screen.getByTestId("row"), 200);
    expect(refetch).not.toHaveBeenCalled();
  });

  it("leaves a sideways swipe and an edge start alone", async () => {
    const { refetch } = renderPull();
    await screen.findByText("נתונים");
    pull(document.body, 30, { dx: -200 });
    pull(document.body, 200, { x: WIDTH - 10 });
    expect(refetch).not.toHaveBeenCalled();
  });

  it("does nothing in a browser tab, which keeps its own pull to refresh", async () => {
    delete document.documentElement.dataset.pullRefresh;
    const { refetch } = renderPull();
    await screen.findByText("נתונים");
    pull(document.body, 200);
    expect(refetch).not.toHaveBeenCalled();
  });

  it("shows the error toast once when a read fails", async () => {
    let calls = 0;
    renderPull(() => {
      calls += 1;
      return calls === 1 ? Promise.resolve("נתונים") : Promise.reject(new Error("read failed"));
    });
    await screen.findByText("נתונים");
    pull(document.body, 200);
    expect(await screen.findByText(PULL_FAILED)).toBeInTheDocument();
    expect(screen.getAllByText(PULL_FAILED)).toHaveLength(1);
  });
});
