import { onlineManager, QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultPeriod } from "../period";
import { renderWithProviders } from "../test-render";
import { backend, DASHBOARD, resetBackend, serve, sumitStatus } from "./connection-page-test-backend";
import { renderPage } from "./connection-page-test-support";
import { ConnectionDetailPage } from "./connection-pages";

vi.mock("../lib/supabase", async () => (await import("./connection-page-test-backend")).supabaseModule());
vi.mock("../edge", async () => (await import("./connection-page-test-backend")).edgeModule());

afterEach(resetBackend);

const CONNECTED = sumitStatus({ connected: true, sumit_company_id: 1001 });
const RETRY = "נסו שוב";
const FAILED = "לא הצלחנו לטעון.";
const down = { data: null, error: { message: "down" } };

/** sumit_status answers `attempt()`, so a test decides each read: a failure, a hang, or the status. */
function serveSumit(attempt: () => Promise<unknown>) {
  backend.rpc = (name) => {
    if (name === "get_dashboard") return Promise.resolve({ data: DASHBOARD, error: null });
    if (name === "sumit_status") return attempt() as ReturnType<typeof backend.rpc>;
    return Promise.resolve({ data: null, error: null });
  };
}

function hang(): { read: () => Promise<unknown>; release: (value: unknown) => void } {
  let release: (value: unknown) => void = () => undefined;
  return { read: () => new Promise((resolve) => { release = resolve; }), release: (value) => { release(value); } };
}

describe("SUMIT page: a failed status read, and where focus goes (FLOW-918)", () => {
  it("shows the load error with a retry; a retry that succeeds shows the connected page and focuses its title", async () => {
    let fail = true;
    serveSumit(() => Promise.resolve(fail ? down : { data: CONNECTED, error: null }));
    renderPage("sumit");
    const retry = await screen.findByRole("button", { name: RETRY });
    expect(screen.getByText(FAILED).closest("[role='status']")).not.toBeNull();
    expect(screen.queryByLabelText("מספר חברה")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניתוק" })).not.toBeInTheDocument();
    fail = false;
    retry.focus();
    fireEvent.click(retry);
    expect(await screen.findByRole("button", { name: "רענון עכשיו" })).toBeInTheDocument();
    expect(screen.queryByText(FAILED)).not.toBeInTheDocument();
    await waitFor(() => { expect(screen.getByRole("heading", { name: "SUMIT" })).toHaveFocus(); });
  });

  it("focuses the page title when the status recovers while נסו שוב is focused", async () => {
    let fail = true;
    serveSumit(() => Promise.resolve(fail ? down : { data: CONNECTED, error: null }));
    const { client } = renderPage("sumit");
    (await screen.findByRole("button", { name: RETRY })).focus();
    fail = false;
    await client.refetchQueries({ queryKey: ["sumit"] });
    await waitFor(() => { expect(screen.getByRole("heading", { name: "SUMIT" })).toHaveFocus(); });
  });

  it("shows the error again when the retry fails again, and the next retry still works", async () => {
    const pending = hang();
    let attempt: () => Promise<unknown> = () => Promise.resolve(down);
    serveSumit(() => attempt());
    renderPage("sumit");
    fireEvent.click(await screen.findByRole("button", { name: RETRY }));
    attempt = pending.read;
    await waitFor(() => { expect(backend.calls.filter((name) => name === "sumit_status")).toHaveLength(2); });
    pending.release(down);
    await waitFor(() => { expect(screen.getByText(FAILED)).toBeInTheDocument(); });
    expect(screen.queryByRole("button", { name: "ניתוק" })).not.toBeInTheDocument();
    attempt = () => Promise.resolve({ data: CONNECTED, error: null });
    fireEvent.click(screen.getByRole("button", { name: RETRY }));
    expect(await screen.findByRole("button", { name: "רענון עכשיו" })).toBeInTheDocument();
  });

  it("leaves focus where the user moved it when the retry fails", async () => {
    const pending = hang();
    let attempt: () => Promise<unknown> = () => Promise.resolve(down);
    serveSumit(() => attempt());
    renderPage("sumit", { wrap: (page) => <><button type="button">מחוץ לדף</button>{page}</> });
    const retry = await screen.findByRole("button", { name: RETRY });
    attempt = pending.read;
    fireEvent.click(retry);
    const elsewhere = screen.getByRole("button", { name: "מחוץ לדף" });
    elsewhere.focus();
    await waitFor(() => { expect(backend.calls.filter((name) => name === "sumit_status")).toHaveLength(2); });
    pending.release(down);
    await waitFor(() => { expect(screen.getByText(FAILED)).toBeInTheDocument(); });
    expect(elsewhere).toHaveFocus();
  });
});

describe("SUMIT page: focus after ניתוק (FLOW-918)", () => {
  async function openDisconnect() {
    serve({ sumit: CONNECTED });
    renderPage("sumit");
    const disconnect = await screen.findByRole("button", { name: "ניתוק" });
    fireEvent.click(disconnect);
    await screen.findByRole("dialog", { name: "לנתק את SUMIT?" });
    return disconnect;
  }

  it("returns to the ניתוק button after Escape", async () => {
    const disconnect = await openDisconnect();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "לנתק את SUMIT?" })).not.toBeInTheDocument(); });
    await waitFor(() => { expect(disconnect).toHaveFocus(); });
  });

  it("returns to the ניתוק button after a tap outside the sheet", async () => {
    const disconnect = await openDisconnect();
    const scrim = document.querySelector(".ui-sheet-scrim") ?? document.body;
    fireEvent.pointerDown(scrim);
    fireEvent.pointerUp(scrim);
    fireEvent.click(scrim);
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "לנתק את SUMIT?" })).not.toBeInTheDocument(); });
    await waitFor(() => { expect(disconnect).toHaveFocus(); });
  });

  it("returns to the ניתוק button after confirming, and says what stays", async () => {
    const disconnect = await openDisconnect();
    fireEvent.click(within(screen.getByRole("dialog", { name: "לנתק את SUMIT?" })).getByRole("button", { name: "ניתוק" }));
    await waitFor(() => { expect(backend.calls).toContain("disconnect_sumit"); });
    expect(await screen.findByText("SUMIT נותק. מה שכבר נכנס נשמר")).toBeInTheDocument();
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "לנתק את SUMIT?" })).not.toBeInTheDocument(); });
    await waitFor(() => { expect(disconnect).toHaveFocus(); });
  });
});

describe("SUMIT page: reconnect and cached states (FLOW-918)", () => {
  it("opens a reconnect on the stored import date", async () => {
    serve({ sumit: sumitStatus({ connected: true, sumit_company_id: 1001, last_error: "sumit_auth", import_from: "2026-03-01" }) });
    renderPage("sumit");
    expect(await screen.findByRole("radio", { name: "מתאריך" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "תאריך ייבוא: 01/03/2026" })).toBeInTheDocument();
    expect(screen.getByLabelText("מספר חברה")).toHaveValue("1001");
  });

  it("shows the problem box and חיבור מחדש for a rejected key", async () => {
    serve({ sumit: sumitStatus({ connected: true, sumit_company_id: 1001, last_error: "sumit_auth" }) });
    renderPage("sumit");
    const box = await screen.findByText(/המפתח הקודם הפסיק לעבוד/);
    expect(box).toHaveClass("ui-connection-problem");
    expect(screen.getByRole("button", { name: "חיבור מחדש" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "רענון עכשיו" })).not.toBeInTheDocument();
  });

  it("keeps a sync failure connected: facts and actions, no problem box", async () => {
    serve({ sumit: sumitStatus({ connected: true, sumit_company_id: 1001, last_error: "sumit_rejected" }) });
    renderPage("sumit");
    expect(await screen.findByRole("button", { name: "רענון עכשיו" })).toBeEnabled();
    expect(screen.getByText("מחובר")).toBeInTheDocument();
    expect(screen.queryByText(/המפתח הקודם הפסיק לעבוד/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "חיבור מחדש" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("מפתח API")).not.toBeInTheDocument();
  });

  it("keeps the last state when a refetch fails and data is cached", async () => {
    let reads = 0;
    serveSumit(() => {
      reads += 1;
      return Promise.resolve(reads === 1 ? { data: CONNECTED, error: null } : down);
    });
    const { client } = renderPage("sumit");
    await screen.findByRole("button", { name: "רענון עכשיו" });
    await client.refetchQueries({ queryKey: ["sumit"] });
    await waitFor(() => { expect(reads).toBeGreaterThan(1); });
    expect(screen.getByRole("button", { name: "רענון עכשיו" })).toBeInTheDocument();
    expect(screen.getByText("מחובר")).toBeInTheDocument();
    expect(screen.queryByText(FAILED)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: RETRY })).not.toBeInTheDocument();
  });

  it("shows a skeleton until the status arrives", async () => {
    const pending = hang();
    serveSumit(pending.read);
    const { container } = renderPage("sumit");
    await waitFor(() => { expect(backend.calls).toContain("sumit_status"); });
    await waitFor(() => { expect(container.querySelector(".ui-skeleton-bar")).toHaveAttribute("aria-hidden", "true"); });
    expect(screen.queryByText("מחובר")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("מספר חברה")).not.toBeInTheDocument();
    pending.release({ data: CONNECTED, error: null });
    expect(await screen.findByRole("button", { name: "רענון עכשיו" })).toBeInTheDocument();
    expect(container.querySelector(".ui-skeleton-bar")).toBeNull();
  });

  it("shows a screen error, with no form, when the dashboard fails", async () => {
    backend.rpc = (name) => Promise.resolve(name === "get_dashboard" || name === "sumit_status" ? down : { data: null, error: null });
    renderPage("sumit");
    expect(await screen.findByText(FAILED)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: RETRY })).toBeInTheDocument();
    expect(screen.queryByLabelText("מספר חברה")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניתוק" })).not.toBeInTheDocument();
  });

  it("never shows a paused read as disconnected, and a preview shows the new form", async () => {
    onlineManager.setOnline(false);
    try {
      backend.rpc = () => new Promise(() => undefined);
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      client.setQueryData(["dashboard", "off", defaultPeriod()], DASHBOARD);
      const { unmount } = renderWithProviders(<ConnectionDetailPage provider="sumit" />, { client, route: "/settings/connections/sumit" });
      await waitFor(() => { expect(document.querySelector(".ui-skeleton-bar")).not.toBeNull(); });
      expect(screen.queryByLabelText("מספר חברה")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "חיבור" })).not.toBeInTheDocument();
      expect(screen.queryByText("מחובר")).not.toBeInTheDocument();
      unmount();
      renderWithProviders(<ConnectionDetailPage provider="sumit" />, { route: "/settings/connections/sumit?preview=1" });
      expect(screen.getByLabelText("מספר חברה")).toHaveValue("");
      expect(screen.getByRole("button", { name: "חיבור" })).toBeDisabled();
      expect(screen.queryByRole("button", { name: RETRY })).not.toBeInTheDocument();
    } finally {
      onlineManager.setOnline(true);
    }
  });
});
