import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { createMemoryRouter, MemoryRouter, RouterProvider, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DropRestoredSheet, resetDropRestoredSheet, resetScrollToWarning, ScrollMemory } from "./back";

function layerOf(state: unknown): string {
  if (typeof state !== "object" || state == null) return "";
  const record = state as Record<string, unknown>;
  const layer = record.flowLayer;
  return typeof layer === "string" ? layer : "";
}

function Place() {
  const location = useLocation();
  const layer = layerOf(location.state);
  return <p>{`${location.pathname}${location.search}${layer === "" ? "" : ` ${layer}`}`}</p>;
}

function Stamp({ idx }: { idx: number }) {
  useLayoutEffect(() => {
    const prev: unknown = window.history.state;
    const base = typeof prev === "object" && prev != null ? prev : {};
    window.history.replaceState({ ...base, idx }, "");
  }, [idx]);
  return null;
}

describe("restored sheet history", () => {
  afterEach(() => {
    resetDropRestoredSheet();
    window.history.replaceState(null, "");
  });

  it("pops a restored sheet so Back does not hit a dead entry", async () => {
    resetDropRestoredSheet();
    const router = createMemoryRouter(
      [{
        path: "*",
        element: (
          <>
            <Stamp idx={2} />
            <DropRestoredSheet />
            <Place />
          </>
        ),
      }],
      {
        initialEntries: [
          "/",
          "/settings",
          { pathname: "/settings", state: { flowLayer: "sumit-connect" } },
        ],
        initialIndex: 2,
      },
    );
    render(<RouterProvider router={router} />);
    await waitFor(() => { expect(screen.getByText("/settings", { exact: true })).toBeInTheDocument(); });
    await act(async () => { await router.navigate(-1); });
    await waitFor(() => { expect(router.state.location.pathname).toBe("/"); });
  });

  it("pops every restored layer so Back does not stop on a dead sheet", async () => {
    resetDropRestoredSheet();
    const router = createMemoryRouter(
      [{
        path: "*",
        element: (
          <>
            <Stamp idx={3} />
            <DropRestoredSheet />
            <Place />
          </>
        ),
      }],
      {
        initialEntries: [
          "/",
          "/settings",
          { pathname: "/settings", state: { flowLayer: "assistant-connect", flowLayers: ["assistant-connect"] } },
          {
            pathname: "/settings",
            state: {
              flowLayer: "assistant-help",
              flowLayers: ["assistant-connect", "assistant-help"],
            },
          },
        ],
        initialIndex: 3,
      },
    );
    render(<RouterProvider router={router} />);
    await waitFor(() => { expect(screen.getByText("/settings", { exact: true })).toBeInTheDocument(); });
  });

  it("leaves a sheet query so the screen can open it", async () => {
    resetDropRestoredSheet();
    const router = createMemoryRouter(
      [{
        path: "*",
        element: (
          <>
            <Stamp idx={1} />
            <DropRestoredSheet />
            <Place />
          </>
        ),
      }],
      {
        initialEntries: [
          "/",
          { pathname: "/settings", search: "?sheet=sumit", state: { flowLayer: "sumit-connect" } },
        ],
        initialIndex: 1,
      },
    );
    render(<RouterProvider router={router} />);
    expect(await screen.findByText("/settings?sheet=sumit sumit-connect")).toBeInTheDocument();
  });
});

function ScrollJump() {
  const navigate = useNavigate();
  return (
    <>
      <ScrollMemory />
      <button type="button" onClick={() => { void navigate("/next"); }}>הבא</button>
      <button type="button" onClick={() => { void navigate(-1); }}>חזרה</button>
    </>
  );
}

describe("scroll restore", () => {
  afterEach(() => {
    resetScrollToWarning();
    vi.restoreAllMocks();
  });

  it("calls scrollTo once under jsdom", () => {
    resetScrollToWarning();
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    render(
      <MemoryRouter>
        <ScrollJump />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "הבא" }));
    fireEvent.click(screen.getByRole("button", { name: "חזרה" }));
    fireEvent.click(screen.getByRole("button", { name: "הבא" }));
    fireEvent.click(screen.getByRole("button", { name: "חזרה" }));
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });
});
