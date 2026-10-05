import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { sheetStack, useSheetHistory } from "./back";

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
