import { QueryClient, useQuery } from "@tanstack/react-query";
import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test-render";
import { PULL_FAILED, pullArmed, PullRefresh, pullTravel } from "./pull-refresh";

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

/** A one-finger drag from (x, 200) by dx and dy in 4 steps; returns the last move. */
function pull(target: EventTarget, dy: number, { x = 200, dx = 0 } = {}) {
  const at = (step: number): Point[] => [{ identifier: 1, clientX: x + (dx * step) / 4, clientY: 200 + (dy * step) / 4 }];
  fire("touchstart", target, at(0));
  let last: Event = new Event("touchmove");
  for (let step = 1; step <= 4; step += 1) last = fire("touchmove", target, at(step));
  fire("touchend", target, []);
  return last;
}

function Reads({ read }: { read: () => Promise<string> }) {
  const query = useQuery({ queryKey: ["pull-test"], queryFn: read });
  return <p>{query.data ?? "…"}</p>;
}

function renderPull(read: () => Promise<string> = () => Promise.resolve("נתונים"), extra: React.ReactNode = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const refetch = vi.spyOn(client, "refetchQueries");
  renderWithProviders(
    <>
      <PullRefresh />
      <Reads read={read} />
      {extra}
    </>,
    { client },
  );
  return { client, refetch };
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
  vi.restoreAllMocks();
});

describe("pull travel", () => {
  it("follows at half the move, from zero, up to a cap", () => {
    expect(pullTravel(-30)).toBe(0);
    expect(pullTravel(0)).toBe(0);
    expect(pullTravel(100)).toBe(50);
    expect(pullTravel(1000)).toBe(96);
  });

  it("arms at 64px of travel", () => {
    expect(pullArmed(63)).toBe(false);
    expect(pullArmed(64)).toBe(true);
    expect(pullArmed(pullTravel(128))).toBe(true);
  });
});

describe("PullRefresh", () => {
  it("refreshes once past the threshold, spins until the reads settle, then collapses", async () => {
    const { refetch } = renderPull();
    await screen.findByText("נתונים");
    const move = pull(document.body, 200);
    expect(move.defaultPrevented).toBe(true);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledWith({ type: "active" });
    expect(status()).toHaveTextContent("מרענן");
    expect(document.querySelector('.ui-pull-refresh[data-phase="refreshing"] .ui-spinner')).not.toBeNull();
    await waitFor(() => { expect(status()).toHaveTextContent(""); });
    await waitFor(() => { expect(document.querySelector(".ui-pull-refresh")).toBeNull(); });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("springs back with nothing done when let go before the threshold", async () => {
    const { refetch } = renderPull();
    await screen.findByText("נתונים");
    pull(document.body, 80);
    expect(refetch).not.toHaveBeenCalled();
    expect(document.querySelector('.ui-pull-refresh[data-phase="closing"]')).not.toBeNull();
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
