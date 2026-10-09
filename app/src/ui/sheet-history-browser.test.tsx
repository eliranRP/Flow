import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { createBrowserRouter, RouterProvider, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import {
  DropRestoredSheet,
  liveSheetStack,
  resetDropRestoredSheet,
  resetPendingSheetPops,
  resetSheetHistoryLock,
  sheetStack,
  useSheetHistory,
} from "./back";

// FLOW-310: sheet history against the browser's own entries (jsdom history), where a pop
// lands later in a popstate and the router's location can trail the entry.

function Place() {
  const location = useLocation();
  return <p data-testid="place">{`${location.pathname}|${sheetStack(location.state).join("+")}`}</p>;
}

function StackedProbe() {
  const [sheet, setSheetOpen] = useState(false);
  const [confirm, setConfirmOpen] = useState(false);
  const setSheet = useSheetHistory("sumit-status", sheet, setSheetOpen);
  const setConfirm = useSheetHistory("sumit-disconnect", confirm, setConfirmOpen);
  return (
    <>
      <Place />
      <button type="button" onClick={() => { setSheet(true); }}>סטטוס</button>
      <button type="button" onClick={() => { setConfirm(true); }}>ניתוק</button>
      <button type="button" onClick={() => { setSheet(false); }}>סגירת סטטוס</button>
      <button
        type="button"
        onClick={() => {
          setConfirm(false);
          setSheet(false);
        }}
      >
        Escape כפול
      </button>
      <p>{`${sheet ? "סטטוס פתוח" : "סטטוס סגור"} ${confirm ? "ניתוק פתוח" : "ניתוק סגור"}`}</p>
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
    resetPendingSheetPops();
    resetSheetHistoryLock();
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

  it("✕ right after the sheet opens leaves no dead Back step", async () => {
    const router = await renderAtSettings();
    fireEvent.click(screen.getByRole("button", { name: "סטטוס" }));
    fireEvent.click(screen.getByRole("button", { name: "סגירת סטטוס" }));
    await settle();
    expect(screen.getByText(/סטטוס סגור/)).toBeInTheDocument();
    expect(screen.getByTestId("place")).toHaveTextContent("/settings|");
    await act(async () => { await router.navigate(-1); });
    await settle();
    expect(router.state.location.pathname).toBe("/");
  });

  it("two closes before the first pop lands pop each layer once", async () => {
    const router = await renderAtSettings();
    fireEvent.click(screen.getByRole("button", { name: "סטטוס" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "ניתוק" }));
    await settle();
    expect(screen.getByTestId("place")).toHaveTextContent("/settings|sumit-status+sumit-disconnect");
    // Escape on the confirm, then on the sheet below, before the first popstate.
    fireEvent.click(screen.getByRole("button", { name: "Escape כפול" }));
    await settle();
    await waitFor(() => {
      expect(screen.getByText("סטטוס סגור ניתוק סגור")).toBeInTheDocument();
    });
    expect(router.state.location.pathname).toBe("/settings");
    expect(sheetStack(router.state.location.state)).toEqual([]);
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
