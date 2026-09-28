import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const auth = vi.hoisted(() => {
  const handlers: Array<(event: string, session: Session | null) => void> = [];
  return { handlers };
});

vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    auth: {
      onAuthStateChange: (callback: (event: string, session: Session | null) => void) => {
        auth.handlers.push(callback);
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
    },
    rpc: (name: string) => {
      if (name === "get_dashboard") {
        return Promise.resolve({
          data: {
            company_id: null,
            name: null,
            vat_registered: true,
            basis: "cash",
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
      if (name === "list_unpaid" || name === "list_review" || name === "list_categories") {
        return Promise.resolve({ data: [], error: null });
      }
      if (name === "sumit_status") {
        return Promise.resolve({
          data: { connected: false, sumit_company_id: null, last_sync_at: null, last_error: null },
          error: null,
        });
      }
      return Promise.resolve({
        data: {
          company_id: null,
          name: null,
          net_profit_agorot: 0,
          is_demo: false,
        },
        error: null,
      });
    },
  }),
}));

const session = {
  access_token: "test",
  refresh_token: "test",
  expires_in: 3600,
  token_type: "bearer",
  user: {
    id: "11111111-1111-1111-1111-111111111111",
    aud: "authenticated",
    app_metadata: {},
    user_metadata: { full_name: "דנה" },
    created_at: "2026-09-27T00:00:00Z",
  },
} satisfies Session;

function emit(event: string, next: Session | null) {
  for (const handler of auth.handlers) handler(event, next);
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  auth.handlers.length = 0;
  onlineManager.setOnline(true);
});

describe("auth guard when Supabase is configured", () => {
  it("shows a skeleton and does not redirect while the session is pending", () => {
    renderAt("/");
    expect(screen.getByText("טוען…")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "כניסה או הרשמה" })).not.toBeInTheDocument();
  });

  it("sends a signed-out session to sign-in with the Google button enabled", () => {
    renderAt("/");
    act(() => {
      emit("INITIAL_SESSION", null);
    });
    expect(screen.getByRole("heading", { name: "כניסה או הרשמה" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "המשך עם Google" })).toBeEnabled();
  });

  it("shows Home after a session, then sign-in after SIGNED_OUT", async () => {
    renderAt("/");
    act(() => {
      emit("INITIAL_SESSION", session);
    });
    expect(await screen.findByRole("heading", { name: "כאן יופיע הרווח הנקי של העסק" })).toBeInTheDocument();
    expect(screen.getByText("שלום, דנה")).toBeInTheDocument();
    act(() => {
      emit("SIGNED_OUT", null);
    });
    expect(await screen.findByRole("heading", { name: "כניסה או הרשמה" })).toBeInTheDocument();
  });

  it("shows the offline screen when the home query is paused", async () => {
    onlineManager.setOnline(false);
    renderAt("/");
    act(() => {
      emit("INITIAL_SESSION", session);
    });
    expect(await screen.findByText("אין חיבור לאינטרנט")).toBeInTheDocument();
    expect(screen.queryByText("עוד אין נתונים")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "העלאת דוח בנק" })).not.toBeInTheDocument();
  });
});
