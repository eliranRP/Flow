import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ColdOpenSkeleton } from "./cold-open";
import { coldOpenRoute } from "./cold-open-route";

describe("coldOpenRoute (FLOW-1140)", () => {
  it("keeps Home's skeleton for Home and the + sheet over it", () => {
    expect(coldOpenRoute("/")).toEqual({ shape: "home", layout: "tab", bar: "own" });
    expect(coldOpenRoute("/add").shape).toBe("home");
  });

  it("draws the FullScreen outlet's routes without the tab bar", () => {
    for (const path of ["/search", "/invites", "/setup", "/setup/bank", "/transactions/t1/split-category", "/transactions/t1/journal", "/install"]) {
      expect(coldOpenRoute(path).layout, path).toBe("full");
    }
    expect(coldOpenRoute("/transactions/t1/journal")).toEqual({ shape: "form", layout: "full", bar: "back", title: "פקודת יומן" });
    expect(coldOpenRoute("/invites")).toEqual({ shape: "list", layout: "full", bar: "plain", title: "הזמנות" });
  });

  it("gives each tab family its own skeleton under the tab bar", () => {
    const shapes: [string, string][] = [
      ["/projects", "projects"],
      ["/loans", "loans"],
      ["/loans/l1", "detail"],
      ["/settings", "settings"],
      ["/settings/categories", "settings"],
      ["/recurring", "recurring"],
      ["/recurring/expense/p1", "detail"],
      ["/profit", "profit"],
      ["/projects/p1/profit", "profit"],
      ["/cash/2026-11/in/ILS", "lines"],
      ["/unpaid", "lines"],
      ["/transfers", "lines"],
      ["/transactions/t1", "detail"],
      ["/unpaid/i1", "detail"],
      ["/review", "list"],
    ];
    for (const [path, shape] of shapes) {
      expect(coldOpenRoute(path), path).toMatchObject({ shape, layout: "tab" });
    }
    expect(coldOpenRoute("/projects").bar).toBe("band");
    expect(coldOpenRoute("/reports/pnl").bar).toBe("band");
    expect(coldOpenRoute("/settings")).toMatchObject({ bar: "plain", title: "הגדרות" });
  });

  it("ignores a trailing slash and falls back to rows under Back for any other route", () => {
    expect(coldOpenRoute("/settings/")).toEqual(coldOpenRoute("/settings"));
    expect(coldOpenRoute("/forecast/next")).toEqual({ shape: "list", layout: "tab", bar: "back" });
  });
});

describe("ColdOpenSkeleton (FLOW-1140)", () => {
  function renderAt(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <ColdOpenSkeleton />
      </MemoryRouter>,
    );
  }

  it("draws a tab route's own bar on the first frame, with the tab bar", () => {
    const { container } = renderAt("/settings");
    expect(screen.getByRole("heading", { name: "הגדרות" })).toBeInTheDocument();
    expect(container.querySelector(".ui-band")).toBeNull();
    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });

  it("draws a full-screen route without the tab bar", () => {
    renderAt("/transactions/t1/journal");
    expect(screen.getByRole("heading", { name: "פקודת יומן" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("draws the band a band screen has", () => {
    const { container } = renderAt("/loans");
    expect(container.querySelector(".ui-band")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "הלוואות" })).toBeInTheDocument();
  });
  it("draws the route's grey blocks after the 300ms wait, from their own file (FLOW-1145)", async () => {
    const { container } = renderAt("/loans");
    expect(container.querySelector(".ui-skel-loans-card")).toBeNull();
    await waitFor(() => {
      expect(container.querySelector(".ui-skel-loans-card")).not.toBeNull();
    }, { timeout: 3000 });
  });
});
