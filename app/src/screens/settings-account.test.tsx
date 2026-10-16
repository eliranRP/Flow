import { type Session } from "@supabase/supabase-js";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth";
import { CategoriesScreen, ConnectionsScreen, SettingsScreen } from "./flow-screens";
import { renderWithProviders } from "../test-render";

/** FLOW-512: the menu. The account email is no longer a Settings row; the business page holds the name. */
function SettingsAndConnections(props: Parameters<typeof SettingsScreen>[0]) {
  return <SettingsScreen sample={props?.sample} />;
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
  it("shows the menu rows, with no account email row", () => {
    renderWithProviders(
      <SettingsScreen
        sample={{
          name: "אלפא",
          connected: false,
          companyId: null,
          lastError: null,
          email: "owner@example.com",
        }}
      />,
    );
    expect(screen.queryByText("owner@example.com")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^העסק/ })).toHaveAttribute("href", "/settings/business");
    expect(screen.getByRole("link", { name: /^חיבורים/ })).toHaveAttribute("href", "/settings/connections");
    expect(screen.queryByRole("link", { name: /^הלוואות/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "תצוגה" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "רווח אחרי הוצאות כלליות" })).not.toBeInTheDocument();
    expect(screen.getByText("Flow 0.1")).toBeInTheDocument();
    expect(screen.queryByText("Flow · POC 0.1")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /התקנה למסך הבית/ })).toBeInTheDocument();
    // FLOW-372: מראה shows the device's choice (the default follows the phone) and sits before the install row.
    const themeRow = screen.getByRole("button", { name: "מראה: לפי המכשיר" });
    expect(themeRow.compareDocumentPosition(screen.getByRole("link", { name: /התקנה למסך הבית/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("link", { name: /קטגוריות/ })).toBeInTheDocument();
  });

  it("shows only the account actions with no company, and no business rows", async () => {
    auth.signOuts = 0;
    const { unmount } = renderWithProviders(
      <SettingsAndConnections
        sample={{
          name: null,
          connected: false,
          companyId: null,
          lastError: null,
          email: "owner@example.com",
          noCompany: true,
        }}
      />,
    );
    expect(screen.queryByRole("link", { name: /^העסק/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^חיבורים/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "תצוגה" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "רווח אחרי הוצאות כלליות" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /מראה/ })).toBeInTheDocument();
    unmount();

    renderWithProviders(
      <SettingsAndConnections
        sample={{
          name: null,
          connected: false,
          companyId: null,
          lastError: null,
          email: "   ",
          noCompany: true,
        }}
      />,
      { route: "/settings?preview=empty" },
    );
    expect(screen.queryByText("owner@example.com")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "התנתקות" }));
    await waitFor(() => { expect(auth.signOuts).toBe(1); });
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
      if (name === "list_categories") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    renderWithProviders(
      <AuthProvider>
        <SettingsAndConnections />
      </AuthProvider>,
      { route: "/settings" },
    );
    act(() => {
      for (const handler of auth.handlers) {
        handler("INITIAL_SESSION", { user: { email: "owner@example.com" } } as Session);
      }
    });
    expect(await screen.findByRole("button", { name: /מראה/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^העסק/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^חיבורים/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "רווח אחרי הוצאות כלליות" })).not.toBeInTheDocument();
    expect(rpc.calls.some((call) => call.name === "set_after_overhead")).toBe(false);
  });

  it("keeps other previews on their sample and hides sign-out", () => {
    auth.handlers.length = 0;
    renderWithProviders(
      <AuthProvider>
        <SettingsAndConnections />
      </AuthProvider>,
      { route: "/settings?preview=1" },
    );
    act(() => {
      for (const handler of auth.handlers) {
        handler("INITIAL_SESSION", { user: { email: "real-owner@example.com" } } as Session);
      }
    });
    expect(screen.getByRole("link", { name: /^העסק/ })).toHaveTextContent("בית הספר אלון");
    expect(screen.queryByText("real-owner@example.com")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "התנתקות" })).not.toBeInTheDocument();
  });

  it("omits the business row when the live business name is empty", async () => {
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
      if (name === "list_categories") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    renderWithProviders(
      <AuthProvider>
        <SettingsAndConnections />
      </AuthProvider>,
      { route: "/settings" },
    );
    act(() => {
      for (const handler of auth.handlers) {
        handler("INITIAL_SESSION", { user: { email: "owner@example.com" } } as Session);
      }
    });
    expect(await screen.findByRole("button", { name: /מראה/ })).toBeInTheDocument();
    expect(screen.queryByText("owner@example.com")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^העסק/ })).not.toBeInTheDocument();
  });

  it("sends categories with no company back to settings", () => {
    const { unmount } = renderWithProviders(
      <Routes>
        <Route path="/settings/categories" element={<CategoriesScreen />} />
        <Route path="/settings" element={<h1>הגדרות</h1>} />
      </Routes>,
      { route: "/settings/categories?preview=empty" },
    );
    expect(screen.getByRole("heading", { name: "הגדרות" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "קטגוריות" })).not.toBeInTheDocument();
    unmount();

    renderWithProviders(
      <>
        <Routes>
          <Route path="/settings/categories" element={<CategoriesScreen />} />
          <Route path="/settings" element={<h1>הגדרות</h1>} />
        </Routes>
      </>,
      { route: "/settings/categories?preview=1" },
    );
    expect(screen.getByRole("heading", { name: "קטגוריות" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "הגדרות" })).not.toBeInTheDocument();
  });
});
