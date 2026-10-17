import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { israelSyncPhrase } from "../sumit-copy";
import { ViewerPreview } from "../use-is-viewer";
import { backend, invokeEdge, mercuryStatus, resetBackend, serve } from "./connection-page-test-backend";
import { renderPage } from "./connection-page-test-support";

vi.mock("../lib/supabase", async () => (await import("./connection-page-test-backend")).supabaseModule());
vi.mock("../edge", async () => (await import("./connection-page-test-backend")).edgeModule());

afterEach(resetBackend);

const KEY = "sample-token-12";
const RECONNECT = mercuryStatus({ connected: false, last_error: "auth", import_from: "2026-03-01" });

function saves() {
  return backend.args.filter(([name]) => name === "set_import_from").map(([, args]) => args);
}

async function typeKey(label = "חיבור") {
  fireEvent.change(await screen.findByLabelText("מפתח API"), { target: { value: KEY } });
  fireEvent.click(screen.getByRole("button", { name: label }));
}

describe("Mercury page: states (FLOW-918)", () => {
  it("shows a skeleton until the status arrives", async () => {
    let release: (value: { data: unknown; error: null }) => void = () => undefined;
    serve({});
    backend.mercuryRow = () => new Promise((resolve) => { release = resolve; });
    const { container } = renderPage("mercury");
    await waitFor(() => { expect(container.querySelector(".ui-skeleton-bar")).toHaveAttribute("aria-hidden", "true"); });
    expect(screen.queryByLabelText("מפתח API")).not.toBeInTheDocument();
    release({ data: mercuryStatus({ connected: true }), error: null });
    expect(await screen.findByRole("button", { name: "רענון עכשיו" })).toBeInTheDocument();
  });

  it("shows the load error and recovers on retry", async () => {
    let fail = true;
    serve({});
    backend.mercuryRow = () => Promise.resolve(fail ? { data: null, error: { message: "down" } } : { data: mercuryStatus({ connected: true }), error: null });
    renderPage("mercury");
    const retry = await screen.findByRole("button", { name: "נסו שוב" });
    expect(screen.getByText("לא הצלחנו לטעון.")).toBeInTheDocument();
    fail = false;
    fireEvent.click(retry);
    expect(await screen.findByRole("button", { name: "רענון עכשיו" })).toBeInTheDocument();
    expect(screen.queryByText("לא הצלחנו לטעון.")).not.toBeInTheDocument();
  });

  it("opens the connect form when disconnected: a key, no company number", async () => {
    serve({});
    renderPage("mercury");
    expect(await screen.findByLabelText("מפתח API")).toBeInTheDocument();
    expect(screen.queryByLabelText("מספר חברה")).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "מההתחלה" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "חיבור" })).toBeDisabled();
  });

  it("shows the sync line when connected", async () => {
    const synced = "2026-10-03T09:05:00.000Z";
    serve({ mercury: mercuryStatus({ connected: true, last_sync_at: synced }) });
    const { container } = renderPage("mercury");
    await screen.findByRole("button", { name: "רענון עכשיו" });
    const phrase = israelSyncPhrase(synced);
    if (phrase == null) throw new Error("missing sync phrase");
    expect(container.textContent).toContain(phrase);
  });

  it("shows the problem box and חיבור מחדש for a rejected key", async () => {
    serve({ mercury: mercuryStatus({ connected: false, last_error: "auth" }) });
    renderPage("mercury");
    expect(await screen.findByText(/Mercury הפסיק לקבל את המפתח/)).toHaveClass("ui-connection-problem");
    expect(screen.getByRole("button", { name: "חיבור מחדש" })).toBeInTheDocument();
  });

  it("opens a reconnect with the stored import date", async () => {
    serve({ mercury: RECONNECT });
    renderPage("mercury");
    expect(await screen.findByRole("radio", { name: "מתאריך" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "תאריך ייבוא: 01/03/2026" })).toBeInTheDocument();
  });

  it("shows a viewer a static page: the facts, no actions, no form", async () => {
    serve({ mercury: mercuryStatus({ connected: true }) });
    renderPage("mercury", { wrap: (page) => <ViewerPreview>{page}</ViewerPreview> });
    expect(await screen.findByText("רק בעל העסק יכול לשנות חיבורים.")).toBeInTheDocument();
    expect(screen.getByText("מחובר")).toBeInTheDocument();
    for (const name of ["רענון עכשיו", "החלפת מפתח API", "ניתוק"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("מפתח API")).not.toBeInTheDocument();
  });
});

describe("Mercury page: connecting (FLOW-918)", () => {
  it("sends the key, clears the field on a failure and on a success, and says it is connected", async () => {
    serve({});
    invokeEdge.mockRejectedValueOnce(new Error("rejected")).mockResolvedValueOnce(undefined);
    renderPage("mercury");
    const field = await screen.findByLabelText("מפתח API");
    await typeKey();
    await waitFor(() => { expect(invokeEdge).toHaveBeenCalledOnce(); });
    expect(invokeEdge.mock.calls[0]?.[0]).toBe("mercury-connect");
    expect(invokeEdge.mock.calls[0]?.[1]).toEqual({ apiKey: KEY, importFrom: undefined });
    await waitFor(() => { expect(field).toHaveValue(""); });
    await typeKey();
    expect(await screen.findByText("Mercury מחובר. המפתח נשאר בשרת.")).toBeInTheDocument();
    expect(field).toHaveValue("");
  });

  it("sends a chosen date with the connect call and leaves ייבוא מ alone when it was not touched", async () => {
    serve({});
    invokeEdge.mockResolvedValue({ connected: true, accounts: 1, import_from_saved: true });
    const { unmount } = renderPage("mercury");
    fireEvent.click(await screen.findByRole("radio", { name: "מתאריך" }));
    expect(screen.getByRole("button", { name: /^תאריך ייבוא: 01\/01\/\d{4}$/ })).toBeInTheDocument();
    await typeKey();
    await screen.findByText("Mercury מחובר. המפתח נשאר בשרת.");
    expect(invokeEdge.mock.calls[0]?.[1]).toMatchObject({ importFrom: expect.stringMatching(/^\d{4}-01-01$/) as unknown });
    unmount();
    invokeEdge.mockClear();
    renderPage("mercury");
    await typeKey();
    await waitFor(() => { expect(invokeEdge).toHaveBeenCalledOnce(); });
    expect(invokeEdge.mock.calls[0]?.[1]).toEqual({ apiKey: KEY, importFrom: undefined });
    expect(saves()).toEqual([]);
  });

  it("keeps a stored date on a reconnect that leaves ייבוא מ alone", async () => {
    serve({ mercury: RECONNECT });
    renderPage("mercury");
    await screen.findByRole("button", { name: "תאריך ייבוא: 01/03/2026" });
    await typeKey("חיבור מחדש");
    await waitFor(() => { expect(invokeEdge).toHaveBeenCalledOnce(); });
    expect(invokeEdge.mock.calls[0]?.[1]).toEqual({ apiKey: KEY, importFrom: undefined });
    await screen.findByText("Mercury מחובר. המפתח נשאר בשרת.");
    expect(saves()).toEqual([]);
  });

  it("saves מההתחלה over a stored date when chosen", async () => {
    serve({ mercury: RECONNECT });
    renderPage("mercury");
    fireEvent.click(await screen.findByRole("radio", { name: "מההתחלה" }));
    await typeKey("חיבור מחדש");
    await waitFor(() => { expect(saves()).toEqual([{ p_provider: "mercury", p_from: null }]); });
    expect(invokeEdge.mock.calls[0]?.[1]).toEqual({ apiKey: KEY, importFrom: null });
  });

  it("says the date was not saved when the connect function reports it failed, and when only the date fails", async () => {
    serve({});
    invokeEdge.mockResolvedValue({ connected: true, accounts: 1, import_from_saved: false });
    const { unmount } = renderPage("mercury");
    fireEvent.click(await screen.findByRole("radio", { name: "מתאריך" }));
    await typeKey();
    expect(await screen.findByText("Mercury מחובר, אבל תאריך הייבוא לא נשמר.")).toBeInTheDocument();
    expect(saves()).toEqual([]);
    unmount();
    invokeEdge.mockResolvedValue(undefined);
    const live = backend.rpc;
    backend.rpc = (name, args) => name === "set_import_from" ? Promise.resolve({ data: null, error: { message: "boom" } }) : live(name, args);
    renderPage("mercury");
    fireEvent.click(await screen.findByRole("radio", { name: "מתאריך" }));
    await typeKey();
    expect(await screen.findByText("Mercury מחובר, אבל תאריך הייבוא לא נשמר.")).toBeInTheDocument();
  });

  it("clears the token when החלפת מפתח API is cancelled and after a success", async () => {
    serve({ mercury: mercuryStatus({ connected: true }) });
    renderPage("mercury");
    fireEvent.click(await screen.findByRole("button", { name: "החלפת מפתח API" }));
    fireEvent.change(screen.getByLabelText("מפתח API"), { target: { value: KEY } });
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    expect(screen.queryByLabelText("מפתח API")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "החלפת מפתח API" }));
    const field = screen.getByLabelText("מפתח API");
    expect(field).toHaveValue("");
    await typeKey("חיבור מחדש");
    await screen.findByText("Mercury מחובר. המפתח נשאר בשרת.");
    await waitFor(() => { expect(screen.queryByLabelText("מפתח API")).not.toBeInTheDocument(); });
    fireEvent.click(screen.getByRole("button", { name: "החלפת מפתח API" }));
    expect(screen.getByLabelText("מפתח API")).toHaveValue("");
  });
});
