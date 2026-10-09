import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { israelSyncPhrase } from "../sumit-copy";
import { ViewerPreview } from "../use-is-viewer";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { ConnectionsScreen } from "./flow-screens";

const rpc = vi.hoisted(() => ({
  impl: (_name: string, _args?: unknown): Promise<{ data: unknown; error: { message: string } | null }> =>
    Promise.resolve({ data: null, error: null }),
}));

const mercuryRow = vi.hoisted(() => ({
  impl: (): Promise<{ data: unknown; error: { message: string } | null }> =>
    Promise.resolve({ data: null, error: null }),
}));

const invokeEdge = vi.hoisted(() => vi.fn((_name: string, _body: Record<string, unknown>) => Promise.resolve(undefined)));

vi.mock("../edge", () => ({
  invokeEdge: (name: string, body: Record<string, unknown>) => invokeEdge(name, body),
  edgeErrorCode: () => Promise.resolve("connect_failed"),
  isRecord: (value: unknown) => typeof value === "object" && value !== null,
  isJsonReader: () => false,
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    auth: {
      onAuthStateChange: (callback: (event: string, session: Session | null) => void) => {
        callback("INITIAL_SESSION", null);
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
      signOut: () => Promise.resolve({ error: null }),
    },
    rpc: (name: string, args?: unknown) => rpc.impl(name, args),
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => mercuryRow.impl(),
        }),
      }),
    }),
  }),
}));

afterEach(() => {
  window.history.replaceState(null, "");
  invokeEdge.mockReset();
  invokeEdge.mockResolvedValue(undefined);
});

const dashboard = {
  company_id: "company-1",
  name: "אלפא",
  vat_registered: true,
  basis: "invoiced",
  from: null,
  to: null,
  income_agorot: 0,
  direct_agorot: 0,
  shared_agorot: 0,
  overhead_agorot: 0,
  expense_agorot: 0,
  net_profit_agorot: 0,
  prev_income_agorot: null,
  prev_expense_agorot: null,
  prev_net_agorot: null,
  active_projects: 0,
  review_count: 0,
  projects: [],
};

function mercury(partial: Record<string, unknown>) {
  return {
    company_id: "company-1",
    provider: "mercury",
    connected: false,
    last_sync_at: null,
    last_error: null,
    next_attempt_at: null,
    import_from: null,
    account_labels: null,
    skip_count: 0,
    ...partial,
  };
}

function renderSettings(ui: ReactNode = <ConnectionsScreen />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BooksProvider>
          <MemoryRouter initialEntries={["/settings"]}>
            {ui}
          </MemoryRouter>
        </BooksProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function hintOf(row: HTMLElement): string {
  return document.getElementById(row.getAttribute("aria-describedby") ?? "")?.textContent ?? "";
}

function mockLive(mercuryData: Record<string, unknown> | null, mercuryError: { message: string } | null = null) {
  rpc.impl = (name) => {
    if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
    if (name === "list_categories") return Promise.resolve({ data: [], error: null });
    return Promise.resolve({ data: null, error: null });
  };
  mercuryRow.impl = () => Promise.resolve({ data: mercuryData, error: mercuryError });
}

describe("Mercury status row", () => {
  it("shows a skeleton until the status arrives", async () => {
    mockLive(null);
    mercuryRow.impl = () => new Promise(() => undefined);
    renderSettings();
    const title = await screen.findByText("Mercury");
    expect(title.closest(".ui-row")).toHaveAttribute("aria-busy", "true");
    expect(title.closest("button")).toBeNull();
  });

  it("shows the error row and recovers on retry", async () => {
    let fail = true;
    mockLive(null);
    mercuryRow.impl = () => {
      if (fail) return Promise.resolve({ data: null, error: { message: "down" } });
      return Promise.resolve({ data: mercury({ connected: true }), error: null });
    };
    renderSettings();
    const retry = await screen.findByRole("button", { name: "ניסיון חוזר: Mercury" });
    fail = false;
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => { expect(screen.getByRole("button", { name: "Mercury" })).toHaveFocus(); });
    expect(hintOf(screen.getByRole("button", { name: "Mercury" }))).toBe("מחובר");
  });

  it("opens the connect sheet when disconnected", async () => {
    mockLive(null);
    renderSettings();
    const row = await screen.findByRole("button", { name: "Mercury" });
    expect(hintOf(row)).toBe("לא מחובר");
    fireEvent.click(row);
    expect(screen.getByRole("dialog", { name: "חיבור Mercury" })).toBeInTheDocument();
  });

  it("shows the sync line when connected", async () => {
    const synced = "2026-10-03T09:05:00.000Z";
    mockLive(mercury({ connected: true, last_sync_at: synced }));
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Mercury" }));
    const sheet = screen.getByRole("dialog", { name: "Mercury" });
    const phrase = israelSyncPhrase(synced);
    if (phrase == null) throw new Error("missing sync phrase");
    expect(sheet.textContent).toContain(phrase);
  });

  it("uses the warning tone for auth reconnect", async () => {
    mockLive(mercury({ connected: false, last_error: "auth" }));
    renderSettings();
    const row = await screen.findByRole("button", { name: "Mercury" });
    expect(row).toHaveClass("ui-row-tone-warning");
    expect(hintOf(row)).toBe("צריך לחבר מחדש");
    fireEvent.click(row);
    expect(screen.getByRole("dialog", { name: "צריך לחבר מחדש את Mercury" })).toBeInTheDocument();
  });

  it("sends apiKey on connect and clears the field on success and failure", async () => {
    mockLive(null);
    invokeEdge
      .mockRejectedValueOnce(new Error("rejected"))
      .mockResolvedValueOnce(undefined);
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Mercury" }));
    const dialog = screen.getByRole("dialog", { name: "חיבור Mercury" });
    const field = within(dialog).getByLabelText("מפתח API");
    fireEvent.change(field, { target: { value: "sample-token-12" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "חיבור" }));
    await waitFor(() => { expect(invokeEdge).toHaveBeenCalledOnce(); });
    expect(invokeEdge.mock.calls[0]?.[0]).toBe("mercury-connect");
    expect(invokeEdge.mock.calls[0]?.[1]).toEqual({ apiKey: "sample-token-12" });
    await waitFor(() => { expect(field).toHaveValue(""); });
    fireEvent.change(field, { target: { value: "another-token-99" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "חיבור" }));
    await waitFor(() => { expect(invokeEdge).toHaveBeenCalledTimes(2); });
    await waitFor(() => { expect(screen.getByText("Mercury מחובר. המפתח נשאר בשרת.")).toBeInTheDocument(); });
    expect(field).toHaveValue("");
  });

  it("saves ייבוא מ after the connection exists (FLOW-505)", async () => {
    mockLive(null);
    const calls: Array<[string, unknown]> = [];
    const live = rpc.impl;
    rpc.impl = (name, args) => { calls.push([name, args]); return live(name, args); };
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Mercury" }));
    const dialog = screen.getByRole("dialog", { name: "חיבור Mercury" });
    expect(within(dialog).getByRole("radio", { name: "מההתחלה" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(dialog).getByRole("radio", { name: "מתאריך" }));
    expect(within(dialog).getByRole("button", { name: /^תאריך ייבוא: 01\/01\/\d{4}$/ })).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("מפתח API"), { target: { value: "sample-token-12" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "חיבור" }));
    await waitFor(() => { expect(calls.some(([name]) => name === "set_import_from")).toBe(true); });
    const saved = calls.find(([name]) => name === "set_import_from")?.[1] as { p_provider: string; p_from: string };
    expect(saved.p_provider).toBe("mercury");
    expect(saved.p_from).toMatch(/^\d{4}-01-01$/);
    expect(invokeEdge).toHaveBeenCalledOnce();
  });

  it("leaves ייבוא מ alone when it was not changed", async () => {
    mockLive(null);
    const names: string[] = [];
    const live = rpc.impl;
    rpc.impl = (name, args) => { names.push(name); return live(name, args); };
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Mercury" }));
    const dialog = screen.getByRole("dialog", { name: "חיבור Mercury" });
    fireEvent.change(within(dialog).getByLabelText("מפתח API"), { target: { value: "sample-token-12" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "חיבור" }));
    await waitFor(() => { expect(screen.getByText("Mercury מחובר. המפתח נשאר בשרת.")).toBeInTheDocument(); });
    expect(names).not.toContain("set_import_from");
  });

  it("keeps a stored date on a reconnect that leaves ייבוא מ alone", async () => {
    mockLive(mercury({ connected: false, last_error: "auth", import_from: "2026-03-01" }));
    const names: string[] = [];
    const live = rpc.impl;
    rpc.impl = (name, args) => { names.push(name); return live(name, args); };
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Mercury" }));
    const dialog = screen.getByRole("dialog", { name: "צריך לחבר מחדש את Mercury" });
    fireEvent.change(within(dialog).getByLabelText("מפתח API"), { target: { value: "sample-token-12" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "חיבור מחדש" }));
    await waitFor(() => { expect(invokeEdge).toHaveBeenCalledOnce(); });
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "צריך לחבר מחדש את Mercury" })).not.toBeInTheDocument(); });
    expect(names).not.toContain("set_import_from");
  });

  it("saves מההתחלה over a stored date when chosen", async () => {
    mockLive(mercury({ connected: false, last_error: "auth", import_from: "2026-03-01" }));
    const calls: Array<[string, unknown]> = [];
    const live = rpc.impl;
    rpc.impl = (name, args) => { calls.push([name, args]); return live(name, args); };
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Mercury" }));
    const dialog = screen.getByRole("dialog", { name: "צריך לחבר מחדש את Mercury" });
    fireEvent.click(within(dialog).getByRole("radio", { name: "מההתחלה" }));
    fireEvent.change(within(dialog).getByLabelText("מפתח API"), { target: { value: "sample-token-12" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "חיבור מחדש" }));
    await waitFor(() => { expect(calls.some(([name]) => name === "set_import_from")).toBe(true); });
    expect(calls.find(([name]) => name === "set_import_from")?.[1]).toEqual({ p_provider: "mercury", p_from: null });
  });

  it("does not save ייבוא מ when the connect fails", async () => {
    mockLive(null);
    invokeEdge.mockRejectedValueOnce(new Error("auth"));
    const names: string[] = [];
    const live = rpc.impl;
    rpc.impl = (name, args) => { names.push(name); return live(name, args); };
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Mercury" }));
    const dialog = screen.getByRole("dialog", { name: "חיבור Mercury" });
    fireEvent.click(within(dialog).getByRole("radio", { name: "מתאריך" }));
    fireEvent.change(within(dialog).getByLabelText("מפתח API"), { target: { value: "sample-token-12" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "חיבור" }));
    expect(await screen.findByText("החיבור נכשל. בדקו את המפתח.")).toBeInTheDocument();
    expect(names).not.toContain("set_import_from");
  });

  it("opens a reconnect with the stored import date", async () => {
    mockLive(mercury({ connected: false, last_error: "auth", import_from: "2026-03-01" }));
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Mercury" }));
    const dialog = screen.getByRole("dialog", { name: "צריך לחבר מחדש את Mercury" });
    expect(within(dialog).getByRole("radio", { name: "מתאריך" })).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).getByRole("button", { name: "תאריך ייבוא: 01/03/2026" })).toBeInTheDocument();
  });

  it("says the date was not saved when only ייבוא מ fails", async () => {
    mockLive(null);
    const live = rpc.impl;
    rpc.impl = (name, args) => name === "set_import_from"
      ? Promise.resolve({ data: null, error: { message: "boom" } })
      : live(name, args);
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Mercury" }));
    const dialog = screen.getByRole("dialog", { name: "חיבור Mercury" });
    fireEvent.click(within(dialog).getByRole("radio", { name: "מתאריך" }));
    fireEvent.change(within(dialog).getByLabelText("מפתח API"), { target: { value: "sample-token-12" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "חיבור" }));
    expect(await screen.findByText("Mercury מחובר, אבל תאריך הייבוא לא נשמר.")).toBeInTheDocument();
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "חיבור Mercury" })).not.toBeInTheDocument(); });
  });

  it("shows refresh.failed when rate limited without a retry time", async () => {
    mockLive(mercury({ connected: true, last_error: "rate_limited", next_attempt_at: null }));
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Mercury" }));
    const sheet = screen.getByRole("dialog", { name: "Mercury" });
    expect(within(sheet).getByText("הרענון נכשל. נסו שוב.")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "רענון עכשיו" })).toBeEnabled();
  });

  it("returns focus to the Mercury row after disconnect confirm dismiss", async () => {
    mockLive(mercury({ connected: true }));
    rpc.impl = (name) => {
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: [], error: null });
      if (name === "disconnect_connector") return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    renderSettings(
      <ConnectionsScreen sample={{ name: "אלפא", connected: true, companyId: 1001, lastError: null, mercuryConnected: true, mercuryLastError: null, mercuryLastSyncAt: "2026-09-30T11:05:00.000Z" }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Mercury" }));
    const disconnect = within(screen.getByRole("dialog", { name: "Mercury" })).getByRole("button", { name: "ניתוק" });
    fireEvent.click(disconnect);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "לנתק את Mercury?" })).not.toBeInTheDocument(); });
    await waitFor(() => { expect(disconnect).toHaveFocus(); });
  });

  it("clears the token when the connect sheet closes", async () => {
    mockLive(null);
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Mercury" }));
    const dialog = screen.getByRole("dialog", { name: "חיבור Mercury" });
    fireEvent.change(within(dialog).getByLabelText("מפתח API"), { target: { value: "sample-token-12" } });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "חיבור Mercury" })).not.toBeInTheDocument(); });
    fireEvent.click(screen.getByRole("button", { name: "Mercury" }));
    expect(within(screen.getByRole("dialog", { name: "חיבור Mercury" })).getByLabelText("מפתח API")).toHaveValue("");
  });

  it("shows a static Mercury row for a viewer", async () => {
    mockLive(mercury({ connected: true }));
    renderSettings(
      <ViewerPreview>
        <ConnectionsScreen />
      </ViewerPreview>,
    );
    const title = await screen.findByText("Mercury");
    const row = title.closest(".ui-row");
    expect(row).not.toBeNull();
    if (row == null) throw new Error("missing row");
    expect(row.querySelector("button")).toBeNull();
    expect(row).toHaveTextContent("מחובר");
  });

  it("sends one refresh when רענון עכשיו is tapped twice", async () => {
    mockLive(mercury({ connected: true }));
    let finish: () => void = () => undefined;
    invokeEdge.mockImplementation(() => new Promise((resolve) => { finish = () => { resolve(undefined); }; }));
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Mercury" }));
    const refresh = within(screen.getByRole("dialog", { name: "Mercury" })).getByRole("button", { name: "רענון עכשיו" });
    fireEvent.click(refresh);
    await waitFor(() => { expect(refresh).toHaveAttribute("aria-busy", "true"); });
    expect(refresh).toHaveAccessibleName("מרענן…");
    expect(refresh.querySelector(".ui-spinner")).not.toBeNull();
    expect(refresh.querySelector(".ui-row-chevron")).toBeNull();
    fireEvent.click(refresh);
    expect(invokeEdge).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => { expect(screen.getByText("הרענון הסתיים.")).toBeInTheDocument(); });
    expect(invokeEdge).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveAccessibleName("רענון עכשיו");
    expect(refresh.querySelector(".ui-spinner")).toBeNull();
  });
});
