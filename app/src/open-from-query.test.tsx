import { render } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { quickNewPath, useOpenFromQuery, type QuickNew } from "./open-from-query";

// FLOW-331 r1: each guard of the one-shot ?new= param has its own case.
let shown = "";
function Probe({ what, ready, open }: { what: QuickNew; ready: boolean; open: () => void }) {
  const location = useLocation();
  shown = `${location.pathname}${location.search}`;
  useOpenFromQuery(what, ready, open);
  return null;
}

function renderAt(path: string, what: QuickNew, ready: boolean, open: () => void) {
  const tree = (next: boolean) => (
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        <Probe what={what} ready={next} open={open} />
      </MemoryRouter>
    </StrictMode>
  );
  const view = render(tree(ready));
  return { setReady: (next: boolean) => { view.rerender(tree(next)); } };
}

describe("useOpenFromQuery", () => {
  it("opens once, even under StrictMode, and drops only new", () => {
    const open = vi.fn();
    renderAt("/projects?preview=1&new=project", "project", true, open);
    expect(open).toHaveBeenCalledTimes(1);
    expect(shown).toBe("/projects?preview=1");
  });

  it("waits while not ready and keeps the param until then", () => {
    const open = vi.fn();
    const view = renderAt("/settings/loans?new=loan", "loan", false, open);
    expect(open).not.toHaveBeenCalled();
    expect(shown).toBe("/settings/loans?new=loan");
    view.setReady(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(shown).toBe("/settings/loans");
  });

  it("leaves another screen's request alone", () => {
    const open = vi.fn();
    renderAt("/projects?new=loan", "project", true, open);
    expect(open).not.toHaveBeenCalled();
    expect(shown).toBe("/projects?new=loan");
  });

  it("builds the path with the preview search kept", () => {
    expect(quickNewPath("/projects", "?preview=1", "project")).toBe("/projects?preview=1&new=project");
    expect(quickNewPath("/settings/loans", "", "loan")).toBe("/settings/loans?new=loan");
  });
});
