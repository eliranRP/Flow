import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BackButton } from "./back";
import { edgeBackHandler, EdgeSwipeBack, useEdgeBack } from "./edge-back";

const WIDTH = 390;

function touches(x: number, y: number) {
  return [{ identifier: 1, clientX: x, clientY: y }];
}

function fire(type: string, target: EventTarget, list: Array<{ identifier: number; clientX: number; clientY: number }>, timeStamp: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { value: type === "touchend" ? [] : list });
  Object.defineProperty(event, "timeStamp", { value: timeStamp });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/** A swipe from (x0, y) by dx and dy over the given time, in 4 steps. */
function swipe(target: EventTarget, x0: number, dx: number, dy = 0, ms = 400) {
  fire("touchstart", target, touches(x0, 400), 0);
  for (let step = 1; step <= 4; step += 1) {
    fire("touchmove", target, touches(x0 + (dx * step) / 4, 400 + (dy * step) / 4), (ms * step) / 4);
  }
  fire("touchend", target, [], ms);
}

function Home() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => { void navigate("/pushed"); }}>
      לפתיחה
    </button>
  );
}

function Pushed({ dialog = false, disabled = false }: { dialog?: boolean; disabled?: boolean }) {
  return (
    <div>
      <BackButton fallback="/" disabled={disabled} />
      <h1>מסך פנימי</h1>
      <input aria-label="שדה" />
      {dialog ? <div role="dialog" aria-label="גיליון" /> : null}
    </div>
  );
}

function renderApp(props: { dialog?: boolean; disabled?: boolean } = {}) {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <EdgeSwipeBack />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/pushed" element={<Pushed {...props} />} />
      </Routes>
    </MemoryRouter>,
  );
  act(() => {
    screen.getByRole("button", { name: "לפתיחה" }).click();
  });
  expect(screen.getByRole("heading", { name: "מסך פנימי" })).toBeInTheDocument();
}

function onHome() {
  return screen.queryByRole("button", { name: "לפתיחה" }) != null;
}

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: WIDTH });
  document.documentElement.dir = "rtl";
  document.documentElement.dataset.edgeBack = "on";
});

afterEach(() => {
  delete document.documentElement.dataset.edgeBack;
});

describe("swipe back from the start edge (FLOW-332)", () => {
  it("goes back after a pull past 30% of the width from the right edge", () => {
    renderApp();
    swipe(screen.getByRole("heading"), WIDTH - 8, -160);
    expect(onHome()).toBe(true);
  });

  it("goes back on a short quick flick", () => {
    renderApp();
    swipe(screen.getByRole("heading"), WIDTH - 8, -60, 0, 80);
    expect(onHome()).toBe(true);
  });

  it("stays on a short slow pull", () => {
    renderApp();
    swipe(screen.getByRole("heading"), WIDTH - 8, -60, 0, 600);
    expect(onHome()).toBe(false);
  });

  it("stays when the touch starts away from the edge", () => {
    renderApp();
    swipe(screen.getByRole("heading"), WIDTH - 40, -200);
    expect(onHome()).toBe(false);
  });

  it("hands a mostly vertical move to the page", () => {
    renderApp();
    swipe(screen.getByRole("heading"), WIDTH - 8, -60, 200);
    expect(onHome()).toBe(false);
  });

  it("does not start while a sheet is open", () => {
    renderApp({ dialog: true });
    swipe(screen.getByRole("heading"), WIDTH - 8, -200);
    expect(onHome()).toBe(false);
  });

  it("does not start from a field", () => {
    renderApp();
    swipe(screen.getByRole("textbox", { name: "שדה" }), WIDTH - 8, -200);
    expect(onHome()).toBe(false);
  });

  it("does not start inside a sideways list", () => {
    renderApp();
    const list = document.createElement("div");
    list.style.overflowX = "auto";
    Object.defineProperty(list, "scrollWidth", { value: 900 });
    Object.defineProperty(list, "clientWidth", { value: 390 });
    const item = document.createElement("span");
    list.append(item);
    document.body.append(list);
    swipe(item, WIDTH - 8, -200);
    expect(onHome()).toBe(false);
    list.remove();
  });

  it("does nothing when the Back button is disabled", () => {
    renderApp({ disabled: true });
    swipe(screen.getByRole("heading"), WIDTH - 8, -200);
    expect(onHome()).toBe(false);
  });

  it("stays off in a browser tab", () => {
    delete document.documentElement.dataset.edgeBack;
    renderApp();
    swipe(screen.getByRole("heading"), WIDTH - 8, -200);
    expect(onHome()).toBe(false);
  });

  it("a second finger ends the pull and takes the mark away", () => {
    renderApp();
    const target = screen.getByRole("heading");
    fire("touchstart", target, touches(WIDTH - 8, 400), 0);
    fire("touchmove", target, touches(WIDTH - 60, 400), 100);
    expect(document.querySelector(".ui-edge-back")).not.toBeNull();
    fire("touchstart", target, [...touches(WIDTH - 60, 400), { identifier: 2, clientX: 100, clientY: 300 }], 150);
    expect(document.querySelector(".ui-edge-back")).toBeNull();
    fire("touchend", target, [], 400);
    expect(onHome()).toBe(false);
  });

  it("shows the back mark while pulling and arms it past the threshold", () => {
    renderApp();
    const target = screen.getByRole("heading");
    fire("touchstart", target, touches(WIDTH - 8, 400), 0);
    fire("touchmove", target, touches(WIDTH - 40, 400), 100);
    const mark = document.querySelector(".ui-edge-back");
    expect(mark).not.toBeNull();
    expect(mark?.classList.contains("ui-edge-back-armed")).toBe(false);
    fire("touchmove", target, touches(WIDTH - 200, 400), 300);
    expect(document.querySelector(".ui-edge-back-armed")).not.toBeNull();
    fire("touchend", target, [], 2000);
    expect(document.querySelector(".ui-edge-back")).toBeNull();
  });
});

describe("which Back the swipe uses", () => {
  function Probe({ name, on, log }: { name: string; on: boolean; log: string[] }) {
    useEdgeBack(on ? () => { log.push(name); } : null);
    return null;
  }

  it("keeps the front-most Back after an older one is disabled and enabled again", () => {
    const log: string[] = [];
    const view = render(<><Probe name="older" on log={log} /><Probe name="front" on log={log} /></>);
    view.rerender(<><Probe name="older" on={false} log={log} /><Probe name="front" on log={log} /></>);
    view.rerender(<><Probe name="older" on log={log} /><Probe name="front" on log={log} /></>);
    edgeBackHandler()?.();
    expect(log).toEqual(["front"]);
  });

  it("does nothing when the front-most Back is disabled", () => {
    const log: string[] = [];
    render(<><Probe name="older" on log={log} /><Probe name="front" on={false} log={log} /></>);
    expect(edgeBackHandler()).toBeNull();
  });
});
