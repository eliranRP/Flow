import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invokeEdge, mercuryStatus, resetBackend, serve, sumitStatus } from "./connection-page-test-backend";
import { renderPage } from "./connection-page-test-support";

vi.mock("../lib/supabase", async () => (await import("./connection-page-test-backend")).supabaseModule());
vi.mock("../edge", async () => (await import("./connection-page-test-backend")).edgeModule());

afterEach(resetBackend);

const SYNCED = "2026-10-03T09:05:00.000Z";
const SUMIT = sumitStatus({ connected: true, sumit_company_id: 1001, last_sync_at: SYNCED });
const MERCURY = mercuryStatus({ connected: true, last_sync_at: SYNCED });

/** An edge call that stays open until `finish` is called. */
function holdEdge(): { finish: (value?: unknown) => void } {
  const held = { finish: (_value?: unknown) => undefined };
  invokeEdge.mockImplementation(() => new Promise((resolve) => { held.finish = (value) => { resolve(value); }; }));
  return held;
}

async function refreshButton() {
  return screen.findByRole("button", { name: "רענון עכשיו" });
}

describe.each([
  ["sumit", "sumit-sync", SUMIT],
  ["mercury", "mercury-sync", MERCURY],
] as const)("%s refresh (FLOW-918)", (provider, edge, status) => {
  const live = provider === "sumit" ? { sumit: status } : { mercury: status };
  const busyStatus = provider === "sumit" ? { sumit: { ...status, syncing: true } } : { mercury: { ...status, syncing: true } };

  it("sends one refresh when רענון עכשיו is tapped twice, busy until it settles", async () => {
    serve(live);
    const held = holdEdge();
    renderPage(provider);
    const refresh = await refreshButton();
    fireEvent.click(refresh);
    await waitFor(() => { expect(refresh).toHaveAttribute("aria-busy", "true"); });
    expect(refresh.querySelector(".ui-spinner")).not.toBeNull();
    fireEvent.click(refresh);
    expect(invokeEdge).toHaveBeenCalledTimes(1);
    expect(invokeEdge).toHaveBeenCalledWith(edge, { force: true });
    held.finish(undefined);
    expect(await screen.findByText("הרענון הסתיים.")).toBeInTheDocument();
    expect(invokeEdge).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveAttribute("aria-busy");
    expect(refresh.querySelector(".ui-spinner")).toBeNull();
  });

  it("shows a refresh that the server is running as busy after a reload, and sends nothing", async () => {
    serve(busyStatus);
    renderPage(provider);
    const refresh = await refreshButton();
    expect(refresh).toHaveAttribute("aria-busy", "true");
    expect(refresh.querySelector(".ui-spinner")).not.toBeNull();
    fireEvent.click(refresh);
    expect(invokeEdge).not.toHaveBeenCalled();
  });

  it("shows a run another tab holds as busy, with no toast, when the server skips this refresh", async () => {
    serve(live);
    invokeEdge.mockResolvedValue({ skipped: true });
    renderPage(provider);
    const refresh = await refreshButton();
    // The server now reports the other tab's run, which the page re-reads after the skip.
    serve(busyStatus);
    fireEvent.click(refresh);
    await waitFor(() => { expect(refresh).toHaveAttribute("aria-busy", "true"); });
    expect(invokeEdge).toHaveBeenCalledOnce();
    expect(screen.queryByText("הרענון נכשל. נסו שוב.")).not.toBeInTheDocument();
    expect(screen.queryByText("הרענון הסתיים.")).not.toBeInTheDocument();
  });
});

describe("refresh outcomes (FLOW-918)", () => {
  it("says how many lines a full Mercury refresh brought in", async () => {
    serve({ mercury: MERCURY });
    invokeEdge.mockResolvedValue({ ok: true, lines: 5, complete: true, inserted: 3, updated: 2, removed: 0 });
    renderPage("mercury");
    fireEvent.click(await refreshButton());
    expect(await screen.findByText("3 תנועות חדשות")).toBeInTheDocument();
  });

  it("does not say a Mercury refresh finished when it failed", async () => {
    serve({ mercury: MERCURY });
    invokeEdge.mockRejectedValue(new Error("rate_limited"));
    renderPage("mercury");
    const refresh = await refreshButton();
    fireEvent.click(refresh);
    expect(await screen.findByText("הרענון נכשל. נסו שוב.")).toBeInTheDocument();
    expect(screen.queryByText("הרענון הסתיים.")).not.toBeInTheDocument();
    await waitFor(() => { expect(refresh).not.toHaveAttribute("aria-busy"); });
  });

  it("does not say a SUMIT refresh finished when it failed", async () => {
    serve({ sumit: SUMIT });
    invokeEdge.mockRejectedValue(new Error("sumit_auth"));
    renderPage("sumit");
    const refresh = await refreshButton();
    fireEvent.click(refresh);
    await waitFor(() => { expect(invokeEdge).toHaveBeenCalledOnce(); });
    await waitFor(() => { expect(refresh).not.toHaveAttribute("aria-busy"); });
    expect(screen.queryByText("הרענון הסתיים.")).not.toBeInTheDocument();
  });
});
