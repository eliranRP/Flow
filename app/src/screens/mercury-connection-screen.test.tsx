import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { israelSyncPhrase } from "../sumit-copy";
import { ViewerPreview } from "../use-is-viewer";
import { backend, invokeEdge, mercuryStatus, resetBackend, serve } from "./connection-page-test-backend";
import { renderPage } from "./connection-page-test-support";

vi.mock("../lib/supabase", async () => (await import("./connection-page-test-backend")).supabaseModule());
vi.mock("../edge", async () => (await import("./connection-page-test-backend")).edgeModule());

afterEach(resetBackend);

// FLOW-938: the Mercury page. Invented names, ids, digits and balances only.
const KEY = "sample-token-12";
const LABELS = [
  { id: "acct-chk", label: "Checking", last4: "4821", kind: "checking", balance_cents: 4_821_000 },
  { id: "acct-sav", label: "Savings", last4: "1093", kind: "savings", balance_cents: 6_250_000 },
  { id: "acct-card", label: "IO Credit", last4: "7710", kind: "credit", balance_cents: -418_200 },
  { id: "acct-tre", label: "Treasury", last4: "5520", kind: "treasury", balance_cents: 12_000_000 },
];
const CONNECTED = mercuryStatus({
  connected: true,
  account_labels: LABELS,
  org_label: "Cedar Lane Homes LLC",
  sync_account_ids: ["acct-chk", "acct-sav", "acct-card"],
  skip_account_ids: ["acct-tre"],
});
const WAITING = mercuryStatus({ connected: true, account_labels: LABELS, accounts_chosen: false, sync_account_ids: null, skip_account_ids: [] });

function rpcArgs(name: string) {
  return backend.args.filter(([called]) => called === name).map(([, args]) => args);
}

/** The status, and the answers of the writes this page makes. */
function serveWith(rows: Record<string, unknown> | Array<Record<string, unknown>> | null) {
  serve({ mercury: rows });
  const live = backend.answer;
  backend.answer = (name, args) => {
    if (name === "set_mercury_accounts") return Promise.resolve({ data: { slot: 1, synced: 3, added: 0, reread: false }, error: null });
    if (name === "disconnect_connector") return Promise.resolve({ data: null, error: null });
    return live(name, args);
  };
}

async function typeKey(label = "חיבור") {
  fireEvent.change(await screen.findByLabelText("מפתח API"), { target: { value: KEY } });
  fireEvent.click(screen.getByRole("button", { name: label }));
}

describe("Mercury page: states (FLOW-918, FLOW-938)", () => {
  it("shows a skeleton until the status arrives", async () => {
    let release: (value: { data: unknown; error: null }) => void = () => undefined;
    serve({});
    backend.mercuryRow = () => new Promise((resolve) => { release = resolve; });
    const { container } = renderPage("mercury");
    await waitFor(() => { expect(container.querySelector(".ui-skeleton-bar")).toHaveAttribute("aria-hidden", "true"); });
    expect(screen.queryByLabelText("מפתח API")).not.toBeInTheDocument();
    release({ data: CONNECTED, error: null });
    expect(await screen.findByRole("button", { name: "רענון עכשיו" })).toBeInTheDocument();
  });

  it("shows the load error and recovers on retry", async () => {
    let fail = true;
    serve({});
    backend.mercuryRow = () => Promise.resolve(fail ? { data: null, error: { message: "down" } } : { data: CONNECTED, error: null });
    renderPage("mercury");
    const retry = await screen.findByRole("button", { name: "נסו שוב" });
    expect(screen.getByText("לא הצלחנו לטעון.")).toBeInTheDocument();
    fail = false;
    fireEvent.click(retry);
    expect(await screen.findByRole("button", { name: "רענון עכשיו" })).toBeInTheDocument();
  });

  it("opens the key form when nothing is connected: a key only, no company number and no date", async () => {
    serve({});
    renderPage("mercury");
    expect(await screen.findByLabelText("מפתח API")).toBeInTheDocument();
    expect(screen.queryByLabelText("מספר חברה")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "מההתחלה" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "חיבור" })).toBeDisabled();
  });

  it("shows the facts without the accounts and card rows, and the synced accounts row with 3 מתוך 4", async () => {
    const synced = "2026-10-03T09:05:00.000Z";
    serveWith({ ...CONNECTED, last_sync_at: synced });
    const { container } = renderPage("mercury");
    const row = await screen.findByRole("button", { name: /^חשבונות מסונכרנים: 3 מתוך 4/ });
    expect(row).toHaveTextContent("Checking ••4821 · Savings ••1093 · IO Credit ••7710");
    expect(screen.getByText("ארגון ב־Mercury")).toBeInTheDocument();
    expect(screen.getByText("Cedar Lane Homes LLC")).toBeInTheDocument();
    expect(screen.queryByText("חשבונות")).not.toBeInTheDocument();
    expect(screen.queryByText("כרטיס")).not.toBeInTheDocument();
    expect(container.textContent).toContain(israelSyncPhrase(synced) ?? "missing");
    expect(screen.getByRole("button", { name: "+ חיבור Mercury נוסף" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ניתוק" })).toBeInTheDocument();
  });

  it("shows the problem box and חיבור מחדש for a rejected key", async () => {
    serveWith({ ...CONNECTED, connected: false, last_error: "auth" });
    renderPage("mercury");
    expect(await screen.findByText(/Mercury הפסיק לקבל את המפתח/)).toHaveClass("ui-connection-problem");
    expect(screen.getByRole("button", { name: "חיבור מחדש" })).toBeInTheDocument();
  });

  it("shows a viewer a static page: the facts and the accounts, nothing to change", async () => {
    serveWith(CONNECTED);
    renderPage("mercury", { wrap: (page) => <ViewerPreview>{page}</ViewerPreview> });
    expect(await screen.findByText("רק בעל העסק יכול לשנות חיבורים.")).toBeInTheDocument();
    expect(screen.getByText("מחובר")).toBeInTheDocument();
    for (const name of ["רענון עכשיו", "החלפת מפתח API", "ניתוק", "+ חיבור Mercury נוסף"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^חשבונות מסונכרנים/ })).not.toBeInTheDocument();
  });
});

describe("Mercury page: the key, then step 3 (FLOW-938)", () => {
  it("sends the key with no date, and goes on to choose the accounts", async () => {
    serveWith(null);
    invokeEdge.mockImplementation((name: string) => {
      if (name === "mercury-connect") {
        serveWith(WAITING);
        return Promise.resolve({ connected: true, slot: 1, accounts: 4, choose_accounts: true });
      }
      return Promise.resolve({ ok: true, complete: true, inserted: 214 });
    });
    renderPage("mercury");
    await typeKey();
    await waitFor(() => { expect(invokeEdge).toHaveBeenCalledWith("mercury-connect", { apiKey: KEY }); });
    expect(await screen.findByText("3 · אילו חשבונות לסנכרן, ומאיזה תאריך")).toBeInTheDocument();
    expect(screen.getByText("Flow מצא 4 חשבונות ב־Mercury. סמנו את אלה של העסק.")).toBeInTheDocument();
    // Checking, savings and the card start checked; treasury does not, with its line.
    const boxes = within(screen.getByRole("group", { name: "חשבונות" })).getAllByRole("checkbox");
    expect(boxes.map((box) => box.getAttribute("aria-checked"))).toEqual(["true", "true", "true", "false"]);
    expect(screen.getByText("כסף מושקע, לא תזרים של העסק. בדרך כלל לא מסנכרנים.")).toBeInTheDocument();
    expect(screen.getByText("$48,210")).toBeInTheDocument();
    expect(screen.getByText("−$4,182")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /מאיזה תאריך לייבא/ })).toHaveTextContent("מההתחלה");
    fireEvent.click(screen.getByRole("button", { name: "סנכרון 3 חשבונות" }));
    await waitFor(() => { expect(rpcArgs("set_mercury_accounts")).toEqual([{ p_slot: 1, p_accounts: ["acct-chk", "acct-sav", "acct-card"], p_from: "start" }]); });
    expect(await screen.findByText("Mercury מחובר · 3 חשבונות · 214 תנועות נכנסו")).toBeInTheDocument();
    expect(invokeEdge).toHaveBeenCalledWith("mercury-sync", { force: true });
  });

  it("needs at least one account, and בחירת כולם / ניקוי הבחירה flip them all", async () => {
    serveWith(WAITING);
    renderPage("mercury");
    fireEvent.click(await screen.findByRole("button", { name: "בחירת כולם" }));
    expect(screen.getByRole("button", { name: "סנכרון 4 חשבונות" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "ניקוי הבחירה" }));
    expect(screen.getByRole("button", { name: "בחרו לפחות חשבון אחד" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Savings/ }));
    expect(screen.getByRole("button", { name: "סנכרון חשבון אחד" })).toBeEnabled();
  });

  it("sends the start the owner picks in the date sheet", async () => {
    serveWith(WAITING);
    renderPage("mercury");
    fireEvent.click(await screen.findByRole("button", { name: /מאיזה תאריך לייבא/ }));
    const sheet = await screen.findByRole("dialog", { name: "מאיזה תאריך לייבא" });
    fireEvent.click(within(sheet).getByRole("radio", { name: /מתחילת השנה/ }));
    await waitFor(() => { expect(screen.getByRole("button", { name: /מאיזה תאריך לייבא/ })).toHaveTextContent("מתחילת השנה"); });
    fireEvent.click(screen.getByRole("button", { name: "סנכרון 3 חשבונות" }));
    await waitFor(() => { expect(rpcArgs("set_mercury_accounts")[0]).toMatchObject({ p_from: expect.stringMatching(/^\d{4}-01-01$/) as unknown }); });
  });
});

describe("Mercury page: the synced accounts, a new account, several connections (FLOW-938)", () => {
  it("edits the synced accounts: an unchecked one says what stays, a checked one brings back the date row", async () => {
    serveWith(CONNECTED);
    renderPage("mercury");
    fireEvent.click(await screen.findByRole("button", { name: /^חשבונות מסונכרנים/ }));
    expect(await screen.findByText("סמנו את החשבונות שנכנסים ל־Flow.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /מאיזה תאריך לייבא/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Savings/ }));
    expect(screen.getByText("מה שכבר נכנס נשאר. תנועות חדשות לא ייכנסו.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Treasury/ }));
    expect(screen.getByText("נכנס מהיום, ואם תרצו גם 24 חודשים אחורה.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /מאיזה תאריך לייבא לחשבון החדש/ })).toHaveTextContent("מהיום");
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(rpcArgs("set_mercury_accounts")).toHaveLength(1); });
    expect(rpcArgs("set_mercury_accounts")[0]).toMatchObject({ p_slot: 1, p_accounts: ["acct-chk", "acct-card", "acct-tre"], p_from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as unknown });
    expect(await screen.findByText("נשמר · 3 חשבונות מסונכרנים")).toBeInTheDocument();
  });

  it("asks about an account Mercury lists that no one answered, and syncs it only on yes", async () => {
    serveWith({ ...CONNECTED, account_labels: [...LABELS, { id: "acct-new", label: "Checking", last4: "6610", kind: "checking" }], import_from: "2026-01-01" });
    renderPage("mercury");
    const card = (await screen.findByText(/ב־Mercury נפתח חשבון חדש/)).closest(".ui-merc-offer") as HTMLElement;
    expect(card).toHaveTextContent("Checking ••6610");
    fireEvent.click(within(card).getByRole("button", { name: "כן, לסנכרן" }));
    await waitFor(() => {
      expect(rpcArgs("set_mercury_accounts")).toEqual([{ p_slot: 1, p_accounts: ["acct-chk", "acct-sav", "acct-card", "acct-new"], p_from: "2026-01-01" }]);
    });
    expect(await screen.findByText("Checking ••6610 מסונכרן")).toBeInTheDocument();
  });

  it("a no keeps the synced accounts as they are, so the account is left out", async () => {
    serveWith({ ...CONNECTED, account_labels: [...LABELS, { id: "acct-new", label: "Checking", last4: "6610", kind: "checking" }] });
    renderPage("mercury");
    fireEvent.click(await screen.findByRole("button", { name: "לא" }));
    await waitFor(() => { expect(rpcArgs("set_mercury_accounts")).toEqual([{ p_slot: 1, p_accounts: ["acct-chk", "acct-sav", "acct-card"], p_from: null }]); });
  });

  it("opens two connections on their list; a row opens one, with its own disconnect", async () => {
    const second = mercuryStatus({ connected: true, slot: 2, org_label: "Cedar Lane Holdings LLC", account_labels: [{ id: "acct-hold", label: "Ops", kind: "checking" }], sync_account_ids: ["acct-hold"] });
    serveWith([CONNECTED, second]);
    renderPage("mercury");
    expect(await screen.findByText("חיבורים ל־Mercury · 2")).toBeInTheDocument();
    expect(screen.getByText(/^3 מתוך 4 חשבונות/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ חיבור Mercury נוסף" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: /Cedar Lane Holdings LLC/ }));
    expect(await screen.findByRole("button", { name: "כל חיבורי Mercury" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ניתוק החיבור הזה" }));
    const confirm = await screen.findByRole("dialog", { name: "לנתק את Cedar Lane Holdings LLC?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "ניתוק" }));
    await waitFor(() => { expect(rpcArgs("disconnect_connector")).toEqual([{ p_provider: "mercury", p_slot: 2 }]); });
  });

  it("adds a connection through the key, from the one connection's page", async () => {
    serveWith(CONNECTED);
    invokeEdge.mockResolvedValue({ connected: true, slot: 2, accounts: 2, choose_accounts: true });
    renderPage("mercury");
    fireEvent.click(await screen.findByRole("button", { name: "+ חיבור Mercury נוסף" }));
    await typeKey();
    await waitFor(() => { expect(invokeEdge).toHaveBeenCalledWith("mercury-connect", { apiKey: KEY }); });
  });
});
