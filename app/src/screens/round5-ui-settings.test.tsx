import { FunctionsHttpError, type Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { CategoriesScreen, ConnectionsScreen, SettingsScreen } from "./flow-screens";

/** FLOW-501 moved the connector rows to their own page. These account tests read both. */
function SettingsAndConnections(props: Parameters<typeof ConnectionsScreen>[0]) {
  return (
    <>
      <SettingsScreen sample={props?.sample} />
      <ConnectionsScreen {...props} />
    </>
  );
}

const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: unknown }>,
  impl: (_name: string, _args?: unknown): Promise<{ data: unknown; error: { message: string } | null }> =>
    Promise.resolve({ data: null, error: null }),
}));

const edge = vi.hoisted(() => ({
  invoke: (_name: string, _body?: unknown): Promise<{ data: unknown; error: unknown }> =>
    Promise.resolve({ data: null, error: null }),
}));

const auth = vi.hoisted(() => ({
  handlers: [] as Array<(event: string, session: Session | null) => void>,
  signOuts: 0,
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    auth: {
      onAuthStateChange: (callback: (event: string, session: Session | null) => void) => {
        auth.handlers.push(callback);
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
      signOut: () => {
        auth.signOuts += 1;
        return Promise.resolve({ error: null });
      },
    },
    rpc: (name: string, args?: unknown) => {
      rpc.calls.push({ name, args });
      return rpc.impl(name, args);
    },
    functions: {
      invoke: (name: string, body?: unknown) => edge.invoke(name, body),
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => {
            if (table === "connector_connection_status") {
              return Promise.resolve({ data: null, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
    }),
  }),
}));

describe("settings account", () => {
  it("shows the business row and a separate Google email row", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <BooksProvider>
          <MemoryRouter>
            <SettingsScreen
              sample={{
                name: "אלפא",
                connected: false,
                companyId: null,
                lastError: null,
                email: "owner@example.com",
              }}
            />
          </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    const business = screen.getByText("אלפא").closest(".ui-row");
    const account = screen.getByText("owner@example.com").closest(".ui-row");
    expect(business).not.toBeNull();
    expect(account).not.toBe(business);
    expect(business?.querySelector("path[fill='#4285F4']")).toBeNull();
    expect(account?.querySelector("path[fill='#4285F4']")).not.toBeNull();
    expect(account?.querySelector(".ui-row-hint")).toBeNull();
    expect(screen.queryByText("עוסק מורשה")).not.toBeInTheDocument();
    expect(screen.queryByText("עוסק פטור")).not.toBeInTheDocument();
    expect(screen.queryByText("חשבון Google")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "פרויקטים" })).not.toBeInTheDocument();
    for (const name of ["סיכום שבועי", "תזכורת לפריטים ממתינים", "אישור אוטומטי בביטחון גבוה"]) {
      expect(screen.queryByRole("switch", { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("heading", { name: "חיבורים" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "חיבורים" })).toHaveAttribute("href", "/settings/connections");
    expect(screen.getByRole("link", { name: "הלוואות" })).toHaveAttribute("href", "/settings/loans");
    expect(screen.getByRole("heading", { name: "תצוגה" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "עוד" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "עוזר" })).not.toBeInTheDocument();
    expect(screen.getByText("Flow 0.1")).toBeInTheDocument();
    expect(screen.queryByText("Flow · POC 0.1")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /התקנה למסך הבית/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /קטגוריות/ })).toBeInTheDocument();
    const overhead = screen.getByRole("switch", { name: "רווח אחרי הוצאות כלליות" });
    expect(document.getElementById(overhead.getAttribute("aria-describedby") ?? "")).toHaveTextContent("חלק מההוצאות הכלליות נכנס לכל פרויקט");
    // FLOW-326: the switch is a grouped row with the icon in the same slot as קטגוריות.
    const overheadRow = overhead.closest("label");
    expect(overheadRow).toHaveClass("ui-row");
    expect(overheadRow?.querySelector(".ui-row-icon svg")).not.toBeNull();
    expect(overheadRow?.closest(".ui-project-list")).toContainElement(screen.getByRole("link", { name: /קטגוריות/ }));
    expect(screen.getByText("חלק מההוצאות הכלליות נכנס לכל פרויקט")).toBeInTheDocument();
  });

  it("shows a static email row when there is no company", async () => {
    auth.signOuts = 0;
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <BooksProvider>
          <MemoryRouter>
            <SettingsAndConnections
              sample={{
                name: null,
                connected: false,
                companyId: null,
                lastError: null,
                email: "owner@example.com",
                noCompany: true,
              }}
            />
          </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    const email = screen.getByText("owner@example.com");
    expect(email.tagName).toBe("BDI");
    expect(email).toHaveAttribute("dir", "ltr");
    expect(email.closest(".ui-row-title")).toHaveAttribute("dir", "ltr");
    expect(email.closest(".ui-row")?.tagName).toBe("DIV");
    expect(email.closest("button")).toBeNull();
    expect(screen.queryByRole("button", { name: "owner@example.com" })).not.toBeInTheDocument();
    expect(screen.queryByText("עדיין בלי עסק")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "תצוגה" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "רווח אחרי הוצאות כלליות" })).not.toBeInTheDocument();
    const sumit = screen.getByRole("button", { name: "SUMIT" });
    expect(sumit).toBeEnabled();
    expect(document.getElementById(sumit.getAttribute("aria-describedby") ?? "")).toHaveTextContent("לא מחובר");
    const assistant = screen.getByRole("button", { name: "עוזר AI" });
    expect(assistant).toHaveAttribute("aria-disabled", "true");
    expect(assistant).not.toHaveAttribute("disabled");
    assistant.focus();
    expect(assistant).toHaveFocus();
    expect(assistant).toHaveClass("ui-row-clear-hint");
    expect(document.getElementById(assistant.getAttribute("aria-describedby") ?? "")).toHaveTextContent("אין עסק עדיין");
    fireEvent.click(assistant);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(email.closest(".ui-row")?.querySelector("path[fill='#4285F4']")).not.toBeNull();
    const calls: string[] = [];
    edge.invoke = (name) => {
      calls.push(name);
      return Promise.resolve({ data: null, error: null });
    };
    fireEvent.click(sumit);
    const sumitSheet = screen.getByRole("dialog", { name: "חיבור SUMIT" });
    expect(within(sumitSheet).queryByLabelText("מספר חברה")).not.toBeInTheDocument();
    expect(within(sumitSheet).queryByLabelText("מפתח API")).not.toBeInTheDocument();
    expect(within(sumitSheet).queryByRole("button", { name: "חיבור" })).not.toBeInTheDocument();
    expect(sumitSheet).toHaveTextContent("כדי לחבר את SUMIT צריך עסק.");
    expect(within(sumitSheet).getByRole("link", { name: "פרטי העסק" })).toHaveAttribute("href", "/onboarding?return=%2Fsettings%2Fconnections%3Fsheet%3Dsumit");
    expect(calls.some((name) => name.includes("sumit-connect"))).toBe(false);
    fireEvent.keyDown(sumitSheet, { key: "Escape" });
    await waitFor(() => { expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); });
    fireEvent.click(screen.getByRole("button", { name: /Mercury/ }));
    const mercurySheet = screen.getByRole("dialog", { name: "חיבור Mercury" });
    expect(mercurySheet).toHaveTextContent("כדי לחבר את Mercury צריך עסק.");
    // Back from the business details opens the Mercury sheet again, not SUMIT's.
    expect(within(mercurySheet).getByRole("link", { name: "פרטי העסק" })).toHaveAttribute("href", "/onboarding?return=%2Fsettings%2Fconnections%3Fsheet%3Dmercury");
    unmount();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <BooksProvider>
          <MemoryRouter initialEntries={["/settings?preview=empty"]}>
            <SettingsAndConnections
              sample={{
                name: null,
                connected: false,
                companyId: null,
                lastError: null,
                email: "   ",
                noCompany: true,
              }}
            />
          </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(screen.queryByText("owner@example.com")).not.toBeInTheDocument();
    expect(screen.queryByText("עדיין בלי עסק")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "תצוגה" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "התנתקות" }));
    await waitFor(() => { expect(auth.signOuts).toBe(1); });
    expect(screen.queryByText("במצב תצוגה זה לא נשמר.")).not.toBeInTheDocument();
  });

  it("treats a live dashboard with a null company id as no company", async () => {
    auth.handlers.length = 0;
    rpc.calls.length = 0;
    rpc.impl = (name) => {
      if (name === "get_dashboard") {
        return Promise.resolve({
          data: {
            company_id: null,
            name: null,
            vat_registered: false,
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
          },
          error: null,
        });
      }
      if (name === "sumit_status") {
        return Promise.resolve({
          data: { connected: false, sumit_company_id: null, last_sync_at: null, last_error: null },
          error: null,
        });
      }
      if (name === "list_categories") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter initialEntries={["/settings"]}>
              <AuthProvider>
                <SettingsAndConnections />
              </AuthProvider>
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    act(() => {
      for (const handler of auth.handlers) {
        handler("INITIAL_SESSION", { user: { email: "owner@example.com" } } as Session);
      }
    });
    const email = await screen.findByText("owner@example.com");
    expect(email.closest("button")).toBeNull();
    expect(email.closest(".ui-row")?.tagName).toBe("DIV");
    expect(screen.queryByText("עדיין בלי עסק")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "תצוגה" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "רווח אחרי הוצאות כלליות" })).not.toBeInTheDocument();
    expect(rpc.calls.some((call) => call.name === "set_after_overhead")).toBe(false);
    const sumit = screen.getByRole("button", { name: "SUMIT" });
    expect(sumit).toBeEnabled();
    expect(sumit).toHaveTextContent("לא מחובר");
    const assistant = screen.getByRole("button", { name: "עוזר AI" });
    expect(assistant).toHaveAttribute("aria-disabled", "true");
    expect(assistant).not.toHaveAttribute("disabled");
    assistant.focus();
    expect(assistant).toHaveFocus();
    expect(assistant).toHaveTextContent("אין עסק עדיין");
    fireEvent.click(assistant);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps ניתוק inside the SUMIT sheet", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter>
              <ConnectionsScreen
                sample={{
                  name: "אלפא",
                  connected: true,
                  companyId: 1001,
                  lastError: null,
                  email: "owner@example.com",
                  assistant: { state: "connected", scope: "read", id: "mcp-1" },
                }}
              />
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("button", { name: "ניתוק" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "SUMIT" }));
    const sumit = screen.getByRole("dialog", { name: "SUMIT" });
    fireEvent.click(within(sumit).getByRole("button", { name: "ניתוק" }));
    expect(screen.getByRole("dialog", { name: "לנתק את SUMIT?" })).toBeInTheDocument();
  });

  it("closes the SUMIT sheet when ניתוק succeeds", async () => {
    rpc.calls.length = 0;
    rpc.impl = () => Promise.resolve({ data: null, error: null });
    let layer: string | null = "unset";
    function Layer() {
      const location = useLocation();
      const state: unknown = location.state;
      if (typeof state !== "object" || state === null || !("flowLayer" in state)) {
        layer = null;
        return null;
      }
      layer = typeof state.flowLayer === "string" ? state.flowLayer : null;
      return null;
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter>
              <Layer />
              <ConnectionsScreen
                sample={{
                  name: "אלפא",
                  connected: true,
                  companyId: 1001,
                  lastError: null,
                  email: "owner@example.com",
                }}
              />
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "SUMIT" }));
    await waitFor(() => { expect(layer).toBe("sumit-status"); });
    fireEvent.click(within(screen.getByRole("dialog", { name: "SUMIT" })).getByRole("button", { name: "ניתוק" }));
    await waitFor(() => { expect(layer).toBe("sumit-disconnect"); });
    fireEvent.click(within(screen.getByRole("dialog", { name: "לנתק את SUMIT?" })).getByRole("button", { name: "ניתוק" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "ניתוק" })).not.toBeInTheDocument();
    await waitFor(() => { expect(layer).toBeNull(); });
    expect(rpc.calls.some((call) => call.name === "disconnect_sumit")).toBe(true);
  });

  it("keeps other previews on their sample and hides sign-out", () => {
    auth.handlers.length = 0;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter initialEntries={["/settings?preview=1"]}>
              <AuthProvider>
                <SettingsAndConnections />
              </AuthProvider>
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    act(() => {
      for (const handler of auth.handlers) {
        handler("INITIAL_SESSION", { user: { email: "real-owner@example.com" } } as Session);
      }
    });
    expect(screen.getByText("בית הספר אלון")).toBeInTheDocument();
    const account = screen.getByText("owner@example.com");
    expect(account.closest("button")).toBeNull();
    expect(screen.queryByText("real-owner@example.com")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: (name) => name.trim() === "" })).not.toBeInTheDocument();
    const sumit = screen.getByRole("button", { name: "SUMIT" });
    expect(document.getElementById(sumit.getAttribute("aria-describedby") ?? "")).toHaveTextContent("לא מחובר");
    expect(screen.getByRole("heading", { name: "תצוגה" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "התנתקות" })).not.toBeInTheDocument();
    fireEvent.click(sumit);
    const connect = screen.getByRole("dialog", { name: "חיבור SUMIT" });
    expect(within(connect).getByLabelText("מספר חברה")).toBeInTheDocument();
    expect(connect).not.toHaveTextContent("כדי לחבר את SUMIT צריך עסק.");
  });

  it("omits the account row when the live business name is empty", async () => {
    auth.handlers.length = 0;
    rpc.impl = (name) => {
      if (name === "get_dashboard") {
        return Promise.resolve({
          data: {
            company_id: "company-1",
            name: null,
            vat_registered: false,
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
          },
          error: null,
        });
      }
      if (name === "sumit_status") {
        return Promise.resolve({
          data: { connected: false, sumit_company_id: null, last_sync_at: null, last_error: null },
          error: null,
        });
      }
      if (name === "list_categories") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter initialEntries={["/settings"]}>
              <AuthProvider>
                <SettingsAndConnections />
              </AuthProvider>
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    act(() => {
      for (const handler of auth.handlers) {
        handler("INITIAL_SESSION", { user: { email: "owner@example.com" } } as Session);
      }
    });
    expect(await screen.findByRole("heading", { name: "תצוגה" })).toBeInTheDocument();
    const sumit = screen.getByRole("button", { name: "SUMIT" });
    expect(document.getElementById(sumit.getAttribute("aria-describedby") ?? "")).toHaveTextContent("לא מחובר");
    expect(screen.queryByText("owner@example.com")).not.toBeInTheDocument();
    expect(screen.queryByText("בית הספר אלון")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: (name) => name.trim() === "" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  function cssPx(value: string): number {
    const root = getComputedStyle(document.documentElement);
    const named = /^var\((--[^),\s]+)\)$/.exec(value.trim());
    const token = named?.[1];
    const resolved = token != null ? root.getPropertyValue(token).trim() : value.trim();
    if (resolved.endsWith("rem")) return Number.parseFloat(resolved) * 16;
    if (resolved.endsWith("px")) return Number.parseFloat(resolved);
    return Number.parseFloat(resolved);
  }

  function declared(selector: string, property: string): string {
    for (const sheet of document.styleSheets) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of rules) {
        if (!(rule instanceof CSSStyleRule)) continue;
        const matches = rule.selectorText.split(",").some((part) => part.trim() === selector);
        if (!matches) continue;
        const value = rule.style.getPropertyValue(property);
        if (value) return value;
      }
    }
    throw new Error(`missing ${selector} ${property}`);
  }

  function lineBox(selector: string): number {
    const size = cssPx(declared(selector, "font-size"));
    const line = declared(selector, "line-height");
    const raw = line.trim().endsWith("px") ? cssPx(line) : cssPx(line) * size;
    return Math.round(raw);
  }

  /** jsdom leaves custom properties unresolved, so the height comes from the rules. */
  function rowHeight(hasHint: boolean): number {
    const pad = cssPx(declared(".ui-row", "padding-block"));
    const border = Number.parseFloat(declared(".ui-row", "border-bottom"));
    const min = cssPx(declared(".ui-row", "min-height"));
    const content = lineBox(".ui-row-title") + (hasHint ? lineBox(".ui-row-hint") : 0) + pad * 2 + border;
    return declared(".ui-row", "box-sizing") === "border-box" ? Math.max(content, min) : content;
  }

  it("uses the single-line height for the account rows, with or without a company", () => {
    document.documentElement.style.setProperty("--row-pad", "14px");
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter>
              <SettingsScreen
                sample={{
                  name: null,
                  connected: false,
                  companyId: null,
                  lastError: null,
                  email: "owner@example.com",
                  noCompany: true,
                }}
              />
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    const single = screen.getByText("owner@example.com").closest(".ui-row");
    expect(single).not.toBeNull();
    expect(single?.querySelector(".ui-row-hint")).toBeNull();
    expect(getComputedStyle(single as Element).boxSizing).toBe("border-box");
    expect(rowHeight(false)).toBe(53);
    unmount();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter>
              <SettingsScreen
                sample={{
                  name: "אלפא",
                  connected: false,
                  companyId: null,
                  lastError: null,
                  email: "owner@example.com",
                }}
              />
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    const paired = screen.getByText("owner@example.com").closest(".ui-row");
    expect(paired?.querySelector(".ui-row-hint")).toBeNull();
    expect(screen.getByText("אלפא").closest(".ui-row")?.querySelector(".ui-row-hint")).toBeNull();
    expect(rowHeight(false)).toBe(53);
    document.documentElement.style.removeProperty("--row-pad");
  });

  it("sends categories with no company back to settings", () => {
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter initialEntries={["/settings/categories?preview=empty"]}>
              <Routes>
                <Route path="/settings/categories" element={<CategoriesScreen />} />
                <Route path="/settings" element={<h1>הגדרות</h1>} />
              </Routes>
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("heading", { name: "הגדרות" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "קטגוריות" })).not.toBeInTheDocument();
    unmount();

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter initialEntries={["/settings/categories?preview=1"]}>
              <Routes>
                <Route path="/settings/categories" element={<CategoriesScreen />} />
                <Route path="/settings" element={<h1>הגדרות</h1>} />
              </Routes>
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("heading", { name: "קטגוריות" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "הגדרות" })).not.toBeInTheDocument();
  });

  it("asks to check the id and the key when connect rejects the key", async () => {
    edge.invoke = () => Promise.resolve({
      data: null,
      error: new FunctionsHttpError({ json: () => Promise.resolve({ error: "sumit_auth" }) }),
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter>
              <ConnectionsScreen
                sample={{
                  name: "אלפא",
                  connected: false,
                  companyId: null,
                  lastError: null,
                }}
              />
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "SUMIT" }));
    fireEvent.change(await screen.findByLabelText("מספר חברה"), { target: { value: "1001" } });
    fireEvent.change(screen.getByLabelText("מפתח API"), { target: { value: "secret-key" } });
    fireEvent.click(screen.getByRole("button", { name: /^חיבור$/ }));
    expect(await screen.findByText("החיבור נכשל. בדקו את המזהה ואת המפתח.")).toBeInTheDocument();
  });

  it("asks to retry when connect fails before SUMIT answers", async () => {
    edge.invoke = () => Promise.resolve({
      data: null,
      error: new Error("Failed to fetch"),
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter>
              <ConnectionsScreen
                sample={{
                  name: "אלפא",
                  connected: false,
                  companyId: null,
                  lastError: null,
                }}
              />
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "SUMIT" }));
    fireEvent.change(await screen.findByLabelText("מספר חברה"), { target: { value: "1001" } });
    fireEvent.change(screen.getByLabelText("מפתח API"), { target: { value: "secret-key" } });
    fireEvent.click(screen.getByRole("button", { name: /^חיבור$/ }));
    expect(await screen.findByText("לא הצלחנו להתחבר. נסו שוב.")).toBeInTheDocument();
    expect(screen.queryByText(/בדקו/)).not.toBeInTheDocument();
  });

  it("disables refresh until the retry time and asks to reconnect after a bad key", () => {
    const later = new Date(Date.now() + 60 * 60_000).toISOString();
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter>
              <ConnectionsScreen
                sample={{
                  name: "אלפא",
                  connected: true,
                  companyId: 1001,
                  lastError: "sumit_rejected",
                  nextAttemptAt: later,
                }}
              />
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    const row = screen.getByRole("button", { name: "SUMIT" });
    expect(document.getElementById(row.getAttribute("aria-describedby") ?? "")).toHaveTextContent("מחובר");
    expect(row).not.toHaveTextContent("לא זמין");
    expect(screen.queryByRole("button", { name: /רענון עכשיו/ })).not.toBeInTheDocument();
    fireEvent.click(row);
    const sheet = screen.getByRole("dialog", { name: "SUMIT" });
    const heldButton = within(sheet).getByRole("button", { name: /רענון עכשיו/ });
    expect(heldButton).toBeDisabled();
    expect(heldButton).toHaveClass("ui-row-clear-hint");
    expect(heldButton.querySelector(".ui-row-chevron")).toBeNull();
    expect(getComputedStyle(heldButton).opacity).toBe("1");
    expect(getComputedStyle(heldButton.querySelector(".ui-row-title") as Element).opacity).toBe("0.45");
    expect(getComputedStyle(heldButton.querySelector(".ui-row-icon") as Element).opacity).toBe("0.45");
    expect(within(sheet).getByText("הרענון נכשל")).toBeInTheDocument();
    expect(within(sheet).queryByText(/נסו שוב/)).not.toBeInTheDocument();
    expect(within(sheet).queryByText("החיבור נכשל")).not.toBeInTheDocument();
    expect(screen.queryByText(/נבדוק שוב מאוחר יותר/)).toBeNull();
    const hint = within(sheet).getByText(/אפשר לנסות שוב/);
    expect(hint.closest("button")).toBe(heldButton);
    expect(hint.querySelector("bdi")).toHaveAttribute("dir", "ltr");
    expect(getComputedStyle(hint).opacity).toBe("1");
    const described = document.getElementById(row.getAttribute("aria-describedby") ?? "");
    expect(getComputedStyle(hint).color).toBe(getComputedStyle(described as Element).color);
    unmount();

    vi.useFakeTimers();
    try {
      const soon = new Date(Date.now() + 5_000).toISOString();
      const held = render(
        <QueryClientProvider client={new QueryClient()}>
          <ToastProvider>
            <BooksProvider>
              <MemoryRouter>
                <ConnectionsScreen
                  sample={{
                    name: "אלפא",
                    connected: true,
                    companyId: 1001,
                    lastError: "sumit_rejected",
                    nextAttemptAt: soon,
                  }}
                />
              </MemoryRouter>
            </BooksProvider>
          </ToastProvider>
        </QueryClientProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: "SUMIT" }));
      expect(screen.getByRole("button", { name: /רענון עכשיו/ })).toBeDisabled();
      act(() => { vi.advanceTimersByTime(5_100); });
      const released = screen.getByRole("button", { name: /רענון עכשיו/ });
      expect(released).toBeEnabled();
      expect(released.querySelector(".ui-row-chevron")).not.toBeNull();
      held.unmount();
    } finally {
      vi.useRealTimers();
    }

    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter>
              <ConnectionsScreen
                sample={{
                  name: "אלפא",
                  connected: true,
                  companyId: 1001,
                  lastError: "sumit_auth",
                  nextAttemptAt: null,
                }}
              />
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    const reconnect = screen.getByRole("button", { name: "SUMIT" });
    expect(reconnect).toHaveClass("ui-row-tone-warning");
    expect(document.getElementById(reconnect.getAttribute("aria-describedby") ?? "")).toHaveTextContent("צריך לחבר מחדש");
    expect(screen.queryByText("החיבור ל־SUMIT נכשל.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /רענון עכשיו/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניתוק" })).not.toBeInTheDocument();
    expect(screen.getAllByText(/מחדש/)).toHaveLength(1);
    fireEvent.click(reconnect);
    const authSheet = screen.getByRole("dialog", { name: "SUMIT" });
    const sheetText = authSheet.textContent;
    const reasonAt = sheetText.indexOf("המזהה או המפתח לא התקבלו");
    const companyAt = sheetText.indexOf("מספר חברה");
    const reconnectAt = sheetText.indexOf("חיבור מחדש");
    const disconnectAt = sheetText.indexOf("ניתוק");
    expect(reasonAt).toBeGreaterThanOrEqual(0);
    expect(reasonAt).toBeLessThan(companyAt);
    expect(companyAt).toBeLessThan(reconnectAt);
    expect(reconnectAt).toBeLessThan(disconnectAt);
    expect(within(authSheet).getByRole("button", { name: "חיבור מחדש" })).toBeInTheDocument();
    expect(within(authSheet).getByRole("button", { name: "ניתוק" })).toBeInTheDocument();
    expect(within(authSheet).queryByText("החיבור ל־SUMIT נכשל.")).not.toBeInTheDocument();
  });
});
