import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { createBrowserRouter, RouterProvider, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DropRestoredSheet,
  liveSheetStack,
  resetDropRestoredSheet,
  resetSheetHistoryLock,
  sheetStack,
  useSheetHistory,
} from "./back";

// FLOW-310: sheet history against the browser's own entries (jsdom history), where the
// router's location can trail the entry a push already wrote.

function Place() {
  const location = useLocation();
  return <p data-testid="place">{`${location.pathname}|${sheetStack(location.state).join("+")}`}</p>;
}

function StackedProbe() {
  const [sheet, setSheetOpen] = useState(false);
  const setSheet = useSheetHistory("sumit-status", sheet, setSheetOpen);
  return (
    <>
      <Place />
      <button type="button" onClick={() => { setSheet(true); }}>סטטוס</button>
      <button type="button" onClick={() => { setSheet(false); }}>סגירת סטטוס</button>
      <p>{sheet ? "סטטוס פתוח" : "סטטוס סגור"}</p>
    </>
  );
}

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
}

async function renderAtSettings() {
  window.history.replaceState(null, "", "/");
  const router = createBrowserRouter([
    { path: "/", element: <h1>בית</h1> },
    { path: "/settings", element: <StackedProbe /> },
  ]);
  render(<RouterProvider router={router} />);
  await act(async () => { await router.navigate("/settings"); });
  return router;
}

describe("sheet history on browser entries", () => {
  afterEach(() => {
    resetSheetHistoryLock();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("reads the browser entry, not a location that has not caught up", () => {
    window.history.replaceState(
      { usr: { flowLayer: "sumit-status", flowLayers: ["sumit-status"] }, key: "k1", idx: 2 },
      "",
    );
    expect(liveSheetStack(null)).toEqual(["sumit-status"]);
    // MemoryRouter tests stamp only idx: the location state is the stack.
    window.history.replaceState({ idx: 2 }, "");
    expect(liveSheetStack({ flowLayers: ["loan-date"] })).toEqual(["loan-date"]);
  });

  it("✕ before the router has caught up with the sheet's entry pops it", async () => {
    const router = await renderAtSettings();
    // The push lands in the browser at once; the router's location follows later (a transition).
    const navigate = router.navigate.bind(router);
    vi.spyOn(router, "navigate").mockImplementation((to, opts) => {
      if (typeof to === "number") return navigate(to, opts);
      const prev = window.history.state as { idx: number };
      const usr: unknown = opts?.state ?? null;
      window.history.pushState({ usr, key: "lagging", idx: prev.idx + 1 }, "", "/settings");
      return Promise.resolve();
    });
    const go = vi.spyOn(window.history, "go");
    fireEvent.click(screen.getByRole("button", { name: "סטטוס" }));
    expect(liveSheetStack(router.state.location.state)).toEqual(["sumit-status"]);
    expect(sheetStack(router.state.location.state)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "סגירת סטטוס" }));
    expect(go).toHaveBeenCalledWith(-1);
    await settle();
    expect(screen.getByText(/סטטוס סגור/)).toBeInTheDocument();
    expect(window.history.state).toMatchObject({ idx: 1 });
  });

  it("a reload with two sheets open drops both entries, so Back leaves the screen", async () => {
    resetDropRestoredSheet();
    window.history.replaceState({ usr: null, key: "a", idx: 0 }, "", "/");
    window.history.pushState({ usr: null, key: "b", idx: 1 }, "", "/settings");
    window.history.pushState(
      { usr: { flowLayer: "sumit-status", flowLayers: ["sumit-status"] }, key: "c", idx: 2 }, "", "/settings",
    );
    window.history.pushState(
      { usr: { flowLayer: "sumit-disconnect", flowLayers: ["sumit-status", "sumit-disconnect"] }, key: "d", idx: 3 },
      "",
      "/settings",
    );
    // The page loads again on the top entry with both sheets closed.
    const router = createBrowserRouter([
      { path: "/", element: <h1>בית</h1> },
      { path: "/settings", element: <><DropRestoredSheet /><StackedProbe /></> },
    ]);
    render(<RouterProvider router={router} />);
    await settle();
    await waitFor(() => { expect(screen.getByTestId("place")).toHaveTextContent("/settings|"); });
    expect(window.history.state).toMatchObject({ key: "b", idx: 1 });
    await act(async () => { await router.navigate(-1); });
    await settle();
    expect(router.state.location.pathname).toBe("/");
  });
});
