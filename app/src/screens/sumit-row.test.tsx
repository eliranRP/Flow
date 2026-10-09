import type { Session } from "@supabase/supabase-js";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultPeriod } from "../period";
import { BooksProvider } from "../use-books";
import { sheetStack } from "../ui/back";
import { ToastProvider } from "../ui/toast";
import { OnboardingScreen, ConnectionsScreen } from "./flow-screens";

const rpc = vi.hoisted(() => ({
  impl: (_name: string, _args?: unknown): Promise<{ data: unknown; error: { message: string } | null }> =>
    Promise.resolve({ data: null, error: null }),
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
    // create_company answers the new company's id, as the RPC does, unless a test says otherwise.
    rpc: async (name: string, args?: unknown) => {
      const answer = await rpc.impl(name, args);
      return name === "create_company" && answer.error == null && answer.data == null ? { data: "company-1", error: null } : answer;
    },
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    // Settings also reads the Jev row. A missing table answer is the off switch.
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
  }),
}));

afterEach(() => {
  window.history.replaceState(null, "");
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

function sumit(partial: Record<string, unknown>) {
  return {
    connected: false,
    sumit_company_id: null,
    last_sync_at: null,
    last_error: null,
    next_attempt_at: null,
    ...partial,
  };
}

function renderSettings(ui: ReactNode = <ConnectionsScreen />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
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
  return { client, ...view };
}

function hintOf(row: HTMLElement): string {
  return document.getElementById(row.getAttribute("aria-describedby") ?? "")?.textContent ?? "";
}

type HistoryVisit = { key: string; search: string; layer: string };

function noteVisit(seen: HistoryVisit[], visit: HistoryVisit) {
  const last = seen[seen.length - 1];
  if (last != null && last.key === visit.key && last.search === visit.search && last.layer === visit.layer) return;
  seen.push(visit);
}

/** Keeps historyIndex() stable while the cold sheet decides to push. */
function holdHistoryIndex(idx: number): () => void {
  const replace = window.history.replaceState.bind(window.history);
  const push = window.history.pushState.bind(window.history);
  const stamp = (state: unknown): unknown => {
    if (typeof state === "object" && state !== null) return { ...state, idx };
    return { idx };
  };
  let released = false;
  window.history.replaceState = ((state: unknown, title: string, url?: string | URL | null) => {
    replace(stamp(state), title, url ?? undefined);
  }) as History["replaceState"];
  window.history.pushState = ((state: unknown, title: string, url?: string | URL | null) => {
    push(stamp(state), title, url ?? undefined);
  }) as History["pushState"];
  replace(stamp(window.history.state), "");
  return () => {
    if (released) return;
    released = true;
    window.history.replaceState = replace;
    window.history.pushState = push;
  };
}

function setHistoryIndex(idx: number) {
  const state: unknown = window.history.state;
  const next = typeof state === "object" && state !== null ? { ...state, idx } : { idx };
  window.history.replaceState(next, "");
}

async function flushTurn() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function SheetVisit({ onVisit }: { onVisit: (visit: HistoryVisit) => void }) {
  const location = useLocation();
  onVisit({
    key: location.key,
    search: location.search,
    layer: sheetStack(location.state).join(","),
  });
  return null;
}

describe("SUMIT status row", () => {
  afterEach(() => {
    window.history.replaceState(null, "");
  });

  it("shows a load error on the row and moves focus when retry succeeds", async () => {
    let fail = true;
    rpc.impl = (name) => {
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: [], error: null });
      if (name === "sumit_status") {
        if (fail) return Promise.resolve({ data: null, error: { message: "down" } });
        return Promise.resolve({ data: sumit({ connected: true, sumit_company_id: 1001 }), error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    renderSettings();
    const retry = await screen.findByRole("button", { name: "ניסיון חוזר: SUMIT" });
    const group = screen.getByRole("group", { name: "SUMIT" });
    expect(group).toHaveTextContent("לא הצלחנו לטעון");
    expect(within(group).getByText("לא הצלחנו לטעון")).toHaveAttribute("role", "status");
    expect(screen.queryByRole("button", { name: "SUMIT" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("מספר חברה")).not.toBeInTheDocument();
    fail = false;
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => { expect(screen.getByRole("button", { name: "SUMIT" })).toHaveFocus(); });
    expect(hintOf(screen.getByRole("button", { name: "SUMIT" }))).toBe("מחובר");
    expect(screen.queryByRole("button", { name: "ניסיון חוזר: SUMIT" })).not.toBeInTheDocument();
  });

  it("moves focus to the SUMIT row when the status recovers while ניסיון חוזר is focused", async () => {
    let fail = true;
    rpc.impl = (name) => {
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: [], error: null });
      if (name === "sumit_status") {
        if (fail) return Promise.resolve({ data: null, error: { message: "down" } });
        return Promise.resolve({ data: sumit({ connected: true, sumit_company_id: 1001 }), error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    const { client } = renderSettings();
    const retry = await screen.findByRole("button", { name: "ניסיון חוזר: SUMIT" });
    retry.focus();
    expect(retry).toHaveFocus();
    fail = false;
    await client.refetchQueries({ queryKey: ["sumit"] });
    await waitFor(() => { expect(screen.getByRole("button", { name: "SUMIT" })).toHaveFocus(); });
  });

  it("returns focus to the SUMIT row when a reconnect passes through loading", async () => {
    let hang = false;
    let release: (value: { data: unknown; error: { message: string } | null }) => void = () => undefined;
    rpc.impl = (name) => {
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: [], error: null });
      if (name === "sumit_status") {
        if (hang) return new Promise((resolve) => { release = resolve; });
        return Promise.resolve({ data: null, error: { message: "down" } });
      }
      return Promise.resolve({ data: null, error: null });
    };
    const { client } = renderSettings();
    const retry = await screen.findByRole("button", { name: "ניסיון חוזר: SUMIT" });
    retry.focus();
    hang = true;
    const done = client.refetchQueries({ queryKey: ["sumit"] });
    await waitFor(() => {
      expect(screen.getByText("SUMIT").closest(".ui-row")).toHaveAttribute("aria-busy", "true");
    });
    expect(screen.queryByRole("button", { name: "ניסיון חוזר: SUMIT" })).not.toBeInTheDocument();
    release({ data: sumit({ connected: true, sumit_company_id: 1001 }), error: null });
    await done;
    await waitFor(() => { expect(screen.getByRole("button", { name: "SUMIT" })).toHaveFocus(); });
  });

  it("does not move focus when the SUMIT status recovers away from ניסיון חוזר", async () => {
    let hang = false;
    let release: (value: { data: unknown; error: { message: string } | null }) => void = () => undefined;
    const connected = { data: sumit({ connected: true, sumit_company_id: 1001 }), error: null };
    rpc.impl = (name) => {
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: [], error: null });
      if (name === "sumit_status") {
        if (hang) return new Promise((resolve) => { release = resolve; });
        return Promise.resolve({ data: null, error: { message: "down" } });
      }
      return Promise.resolve({ data: null, error: null });
    };
    function SheetSpot() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => { setOpen(true); }}>גיליון</button>
          {open ? (
            <div role="dialog" aria-label="גיליון">
              <button type="button">בגיליון</button>
            </div>
          ) : null}
        </>
      );
    }
    const pressed = renderSettings(<><SheetSpot /><ConnectionsScreen /></>);
    const retry = await screen.findByRole("button", { name: "ניסיון חוזר: SUMIT" });
    retry.focus();
    hang = true;
    fireEvent.click(retry);
    await waitFor(() => {
      const link = screen.queryByRole("button", { name: "ניסיון חוזר: SUMIT" });
      const row = screen.getByText("SUMIT").closest(".ui-row");
      expect(link?.getAttribute("aria-busy") === "true" || row?.getAttribute("aria-busy") === "true").toBe(true);
    });
    fireEvent.click(screen.getByRole("button", { name: "גיליון" }));
    const inside = screen.getByRole("button", { name: "בגיליון" });
    inside.focus();
    expect(inside).toHaveFocus();
    release(connected);
    await waitFor(() => { expect(screen.getByRole("button", { name: "SUMIT" })).toBeInTheDocument(); });
    expect(inside).toHaveFocus();
    pressed.unmount();

    hang = false;
    const failed = renderSettings();
    const failedRetry = await screen.findByRole("button", { name: "ניסיון חוזר: SUMIT" });
    failedRetry.focus();
    hang = true;
    fireEvent.click(failedRetry);
    await waitFor(() => { expect(failedRetry).toHaveAttribute("aria-busy", "true"); });
    release({ data: null, error: { message: "down" } });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "ניסיון חוזר: SUMIT" })).toHaveFocus();
      expect(screen.getByRole("button", { name: "ניסיון חוזר: SUMIT" })).not.toHaveAttribute("aria-busy", "true");
    });
    const elsewhere = screen.getByRole("button", { name: "חזרה להגדרות" });
    elsewhere.focus();
    expect(elsewhere).toHaveFocus();
    hang = true;
    const again = failed.client.refetchQueries({ queryKey: ["sumit"] });
    await waitFor(() => {
      expect(screen.getByText("SUMIT").closest(".ui-row")).toHaveAttribute("aria-busy", "true");
    });
    release(connected);
    await again;
    await waitFor(() => { expect(screen.getByRole("button", { name: "SUMIT" })).toBeInTheDocument(); });
    expect(elsewhere).toHaveFocus();
    failed.unmount();

    hang = false;
    const blank = renderSettings();
    const blankRetry = await screen.findByRole("button", { name: "ניסיון חוזר: SUMIT" });
    blankRetry.focus();
    blankRetry.blur();
    expect(document.activeElement).toBe(document.body);
    hang = true;
    const recovered = blank.client.refetchQueries({ queryKey: ["sumit"] });
    await waitFor(() => {
      expect(screen.getByText("SUMIT").closest(".ui-row")).toHaveAttribute("aria-busy", "true");
    });
    release(connected);
    await recovered;
    await waitFor(() => { expect(screen.getByRole("button", { name: "SUMIT" })).toBeInTheDocument(); });
    expect(screen.getByRole("button", { name: "SUMIT" })).not.toHaveFocus();
    expect(document.activeElement).toBe(document.body);
  });

  it("keeps focus on ניסיון חוזר when the retry fails again", async () => {
    const failed = Promise.resolve({ data: null, error: { message: "down" } });
    let attempt: Promise<{ data: unknown; error: { message: string } | null }> = failed;
    let release: (value: { data: unknown; error: { message: string } | null }) => void = () => undefined;
    rpc.impl = (name) => {
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: [], error: null });
      if (name === "sumit_status") return attempt;
      return Promise.resolve({ data: null, error: null });
    };
    renderSettings();
    const retry = await screen.findByRole("button", { name: "ניסיון חוזר: SUMIT" });
    attempt = new Promise((resolve) => { release = resolve; });
    retry.focus();
    fireEvent.click(retry);
    expect(retry).toHaveAttribute("aria-busy", "true");
    const hint = within(screen.getByRole("group", { name: "SUMIT" })).getByText("לא הצלחנו לטעון");
    const seen = [hint.textContent];
    const observer = new MutationObserver(() => { seen.push(hint.textContent); });
    observer.observe(hint, { characterData: true, childList: true, subtree: true });
    release({ data: null, error: { message: "down" } });
    await waitFor(() => {
      expect(seen).toContain("");
      expect(hint).toHaveTextContent("לא הצלחנו לטעון");
      expect(hint).toHaveAttribute("role", "status");
      expect(screen.getByRole("button", { name: "ניסיון חוזר: SUMIT" })).toHaveFocus();
    });
    observer.disconnect();
    expect(screen.queryByRole("button", { name: "SUMIT" })).not.toBeInTheDocument();
  });

  it("leaves focus where the user moved it when the retry fails", async () => {
    const failed = Promise.resolve({ data: null, error: { message: "down" } });
    let attempt: Promise<{ data: unknown; error: { message: string } | null }> = failed;
    let release: (value: { data: unknown; error: { message: string } | null }) => void = () => undefined;
    rpc.impl = (name) => {
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: [], error: null });
      if (name === "sumit_status") return attempt;
      return Promise.resolve({ data: null, error: null });
    };
    renderSettings();
    const retry = await screen.findByRole("button", { name: "ניסיון חוזר: SUMIT" });
    attempt = new Promise((resolve) => { release = resolve; });
    fireEvent.click(retry);
    const elsewhere = screen.getByRole("button", { name: "חזרה להגדרות" });
    elsewhere.focus();
    release({ data: null, error: { message: "down" } });
    await waitFor(() => {
      expect(within(screen.getByRole("group", { name: "SUMIT" })).getByText("לא הצלחנו לטעון")).toBeInTheDocument();
    });
    expect(elsewhere).toHaveFocus();
    expect(screen.queryByRole("button", { name: "SUMIT" })).not.toBeInTheDocument();
  });

  it("keeps the last state when a refetch fails and data is cached", async () => {
    let calls = 0;
    rpc.impl = (name) => {
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: [], error: null });
      if (name === "sumit_status") {
        calls += 1;
        if (calls === 1) return Promise.resolve({ data: sumit({ connected: true, sumit_company_id: 1001, last_error: "sumit_rejected" }), error: null });
        return Promise.resolve({ data: null, error: { message: "down" } });
      }
      return Promise.resolve({ data: null, error: null });
    };
    const { client } = renderSettings();
    const row = await screen.findByRole("button", { name: "SUMIT" });
    expect(hintOf(row)).toBe("מחובר");
    await client.refetchQueries({ queryKey: ["sumit"] });
    await waitFor(() => { expect(calls).toBeGreaterThan(1); });
    const kept = screen.getByRole("button", { name: "SUMIT" });
    expect(hintOf(kept)).toBe("מחובר");
    expect(screen.queryByRole("button", { name: "ניסיון חוזר: SUMIT" })).not.toBeInTheDocument();
    expect(within(kept).queryByText("לא הצלחנו לטעון")).not.toBeInTheDocument();
  });

  it("opens a SUMIT reconnect on the stored import date (FLOW-505)", async () => {
    rpc.impl = (name) => {
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: [], error: null });
      if (name === "sumit_status") {
        return Promise.resolve({ data: sumit({ connected: true, sumit_company_id: 1001, last_error: "sumit_auth", import_from: "2026-03-01" }), error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "SUMIT" }));
    const sheet = screen.getByRole("dialog", { name: "SUMIT" });
    expect(within(sheet).getByRole("radio", { name: "מתאריך" })).toHaveAttribute("aria-checked", "true");
    expect(within(sheet).getByRole("button", { name: "תאריך ייבוא: 01/03/2026" })).toBeInTheDocument();
  });

  it("uses the warning tone for a rejected key and keeps a sync failure connected", async () => {
    rpc.impl = (name) => {
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: [], error: null });
      if (name === "sumit_status") {
        return Promise.resolve({ data: sumit({ connected: true, sumit_company_id: 1001, last_error: "sumit_auth" }), error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter>
              <ConnectionsScreen />
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    const warning = await screen.findByRole("button", { name: "SUMIT" });
    expect(warning).toHaveClass("ui-row-tone-warning");
    expect(hintOf(warning)).toBe("צריך לחבר מחדש");
    expect(screen.queryByText("החיבור ל־SUMIT נכשל.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר: SUMIT" })).not.toBeInTheDocument();
    unmount();

    rpc.impl = (name) => {
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: [], error: null });
      if (name === "sumit_status") {
        return Promise.resolve({ data: sumit({ connected: true, sumit_company_id: 1001, last_error: "sumit_rejected" }), error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter>
              <ConnectionsScreen />
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    const row = await screen.findByRole("button", { name: "SUMIT" });
    expect(row).not.toHaveClass("ui-row-tone-warning");
    expect(hintOf(row)).toBe("מחובר");
    expect(row).not.toHaveTextContent("לא זמין");
    fireEvent.click(row);
    const sheet = screen.getByRole("dialog", { name: "SUMIT" });
    expect(within(sheet).getByText("SUMIT לא זמין כרגע.")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "רענון עכשיו" })).toBeEnabled();
  });

  it("shows a skeleton until the status arrives and a screen error when the dashboard fails", async () => {
    rpc.impl = (name) => {
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: [], error: null });
      if (name === "sumit_status") return new Promise(() => undefined);
      return Promise.resolve({ data: null, error: null });
    };
    const { unmount } = renderSettings();
    expect(await screen.findByRole("heading", { name: "חיבורים" })).toBeInTheDocument();
    const title = await screen.findByText("SUMIT");
    expect(title.closest(".ui-row")).toHaveAttribute("aria-busy", "true");
    expect(title.closest("button")).toBeNull();
    expect(screen.getByText("טוען…")).toHaveAttribute("role", "status");
    expect(screen.queryByText("מחובר")).not.toBeInTheDocument();
    expect(title.closest(".ui-row")?.querySelector(".ui-skeleton-bar")).toHaveAttribute("aria-hidden", "true");
    unmount();

    rpc.impl = (name) => {
      if (name === "get_dashboard") return Promise.resolve({ data: null, error: { message: "down" } });
      if (name === "sumit_status") return Promise.resolve({ data: null, error: { message: "down" } });
      return Promise.resolve({ data: null, error: null });
    };
    renderSettings();
    expect(await screen.findByText("לא הצלחנו לטעון את הנתונים")).toBeInTheDocument();
    expect(screen.queryByText("שגיאה")).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "תיוג חכם (Jev)" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר: SUMIT" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "SUMIT" })).not.toBeInTheDocument();
  });

  it("opens the SUMIT sheet from a same-app return and sends onboarding home by default", async () => {
    window.history.replaceState({ idx: 0 }, "");
    try {
    rpc.impl = (name) => {
      if (name === "get_dashboard") return Promise.resolve({ data: { ...dashboard, company_id: "company-1" }, error: null });
      if (name === "list_categories") return Promise.resolve({ data: [], error: null });
      if (name === "sumit_status") return Promise.resolve({ data: sumit({}), error: null });
      return Promise.resolve({ data: null, error: null });
    };
    function Place() {
      const location = useLocation();
      return <p>{`${location.pathname}${location.search}`}</p>;
    }
    const router = createMemoryRouter(
      [
        { path: "/settings", element: <><Place /><ConnectionsScreen /></> },
        { path: "/", element: <h1>בית</h1> },
      ],
      { initialEntries: ["/settings?sheet=sumit"] },
    );
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <BooksProvider>
            <RouterProvider router={router} />
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    const sheet = await screen.findByRole("dialog", { name: "חיבור SUMIT" });
    expect(within(sheet).getByLabelText("מספר חברה")).toBeInTheDocument();
    await waitFor(() => { expect(router.state.location.search).toBe(""); });
    expect(router.state.location.pathname).toBe("/settings");
    const openKey = router.state.location.key;
    await act(async () => { await router.navigate(-1); });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/settings");
      expect(router.state.location.search).toBe("");
      expect(router.state.location.key).not.toBe(openKey);
    });
    act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
    await waitFor(() => { expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); });
    expect(screen.queryByRole("heading", { name: "בית" })).not.toBeInTheDocument();
    unmount();

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter initialEntries={["/onboarding?return=/settings?sheet=sumit"]}>
              <Routes>
                <Route path="/onboarding" element={<OnboardingScreen />} />
                <Route path="/settings" element={<h1>הגדרות</h1>} />
                <Route path="/" element={<h1>בית</h1>} />
              </Routes>
              <Place />
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("שם העסק"), { target: { value: "אלפא" } });
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    expect(await screen.findByRole("heading", { name: "הגדרות" })).toBeInTheDocument();
    expect(screen.getByText("/settings?sheet=sumit")).toBeInTheDocument();
    } finally {
      window.history.replaceState(null, "");
    }
  });

  it("pushes a cold sheet again after close, so Back closes the reopened sheet", async () => {
    rpc.impl = (name) => {
      if (name === "get_dashboard") return Promise.resolve({ data: { ...dashboard, company_id: "company-1" }, error: null });
      if (name === "list_categories") return Promise.resolve({ data: [], error: null });
      if (name === "sumit_status") return Promise.resolve({ data: sumit({}), error: null });
      return Promise.resolve({ data: null, error: null });
    };
    const seen: HistoryVisit[] = [];
    const releaseIndex = holdHistoryIndex(0);
    const router = createMemoryRouter(
      [
        { path: "/settings", element: <><SheetVisit onVisit={(visit) => { noteVisit(seen, visit); }} /><ConnectionsScreen /></> },
        { path: "/", element: <h1>בית</h1> },
      ],
      { initialEntries: ["/settings?sheet=sumit"] },
    );
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <BooksProvider>
            <RouterProvider router={router} />
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    try {
      const sheet = await screen.findByRole("dialog", { name: "חיבור SUMIT" });
      await waitFor(() => {
        const layer = [...seen].reverse().find((entry) => entry.layer === "sumit-connect");
        const settings = [...seen].reverse().find((entry) => entry.search === "" && entry.layer === "" && entry.key !== layer?.key);
        expect(layer?.key).toBeTruthy();
        expect(settings?.key).toBeTruthy();
        expect(layer?.key).not.toBe(settings?.key);
      });
      const open = [...seen].reverse().find((entry) => entry.layer === "sumit-connect");
      const settings = [...seen].reverse().find((entry) => entry.search === "" && entry.layer === "" && entry.key !== open?.key);
      if (open == null || settings == null) throw new Error("missing sheet entry");
      releaseIndex();
      setHistoryIndex(1);
      fireEvent.click(within(sheet).getByRole("button", { name: "סגירה" }));
      await flushTurn();
      await waitFor(() => {
        expect(router.state.location.key).toBe(settings.key);
        expect(router.state.location.pathname).toBe("/settings");
        expect(router.state.location.search).toBe("");
      });
      act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
      await waitFor(() => { expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); });
      expect(screen.queryByRole("heading", { name: "בית" })).not.toBeInTheDocument();

      setHistoryIndex(0);
      fireEvent.click(screen.getByRole("button", { name: "SUMIT" }));
      await flushTurn();
      await screen.findByRole("dialog", { name: "חיבור SUMIT" });
      await waitFor(() => {
        expect(router.state.location.key).not.toBe(settings.key);
        expect(router.state.location.state).toMatchObject({ flowLayer: "sumit-connect" });
      });
      const again = router.state.location.key;
      setHistoryIndex(1);
      await act(async () => { await router.navigate(-1); });
      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/settings");
        expect(router.state.location.search).toBe("");
        expect(router.state.location.key).not.toBe(again);
        expect(router.state.location.key).toBe(settings.key);
      });
      act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
      await waitFor(() => { expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); });
      expect(screen.queryByRole("heading", { name: "בית" })).not.toBeInTheDocument();
    } finally {
      releaseIndex();
      window.history.replaceState(null, "");
    }
  });

  it("ניתוק on a cold deep link lands on that settings entry", async () => {
    rpc.impl = (name) => {
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: [], error: null });
      if (name === "sumit_status") return Promise.resolve({ data: sumit({ connected: true, sumit_company_id: 1001 }), error: null });
      if (name === "disconnect_sumit") return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    window.history.replaceState({ idx: 0 }, "");
    const seen: string[] = [];
    function Watch() {
      const location = useLocation();
      if (location.pathname === "/settings" && location.search === "") seen.push(location.key);
      return null;
    }
    const router = createMemoryRouter(
      [
        { path: "/settings", element: <><Watch /><ConnectionsScreen /></> },
        { path: "/", element: <h1>בית</h1> },
      ],
      { initialEntries: ["/settings?sheet=sumit"] },
    );
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <BooksProvider>
            <RouterProvider router={router} />
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    try {
      await screen.findByRole("dialog", { name: "SUMIT" });
      await waitFor(() => { expect(router.state.location.search).toBe(""); });
      const sheetKey = router.state.location.key;
      fireEvent.click(within(screen.getByRole("dialog", { name: "SUMIT" })).getByRole("button", { name: "ניתוק" }));
      await screen.findByRole("dialog", { name: "לנתק את SUMIT?" });
      window.history.replaceState({ idx: 2 }, "");
      fireEvent.click(within(screen.getByRole("dialog", { name: "לנתק את SUMIT?" })).getByRole("button", { name: "ניתוק" }));
      await waitFor(() => { expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); });
      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/settings");
        expect(router.state.location.search).toBe("");
        expect(router.state.location.key).not.toBe(sheetKey);
        const deepLink = seen.find((key) => key !== sheetKey);
        expect(deepLink).toBeTruthy();
        expect(router.state.location.key).toBe(deepLink);
      });
      const landed = router.state.location.key;
      await act(async () => { await router.navigate(-1); });
      await waitFor(() => {
        expect(router.state.location.key).toBe(landed);
        expect(router.state.location.pathname).toBe("/settings");
      });
      expect(screen.queryByRole("heading", { name: "בית" })).not.toBeInTheDocument();
    } finally {
      window.history.replaceState(null, "");
    }
  });

  it("drops an off-site return and keeps Home as the default", async () => {
    function Place() {
      const location = useLocation();
      return <p>{`${location.pathname}${location.search}`}</p>;
    }
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter initialEntries={["/onboarding?return=https://evil.example/steal"]}>
              <Routes>
                <Route path="/onboarding" element={<OnboardingScreen />} />
                <Route path="/" element={<h1>בית</h1>} />
              </Routes>
              <Place />
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("שם העסק"), { target: { value: "אלפא" } });
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    expect(await screen.findByRole("heading", { name: "בית" })).toBeInTheDocument();
    expect(screen.getByText("/")).toBeInTheDocument();
    unmount();

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter initialEntries={["/onboarding"]}>
              <Routes>
                <Route path="/onboarding" element={<OnboardingScreen />} />
                <Route path="/" element={<h1>בית</h1>} />
              </Routes>
              <Place />
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("שם העסק"), { target: { value: "אלפא" } });
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    expect(await screen.findByRole("heading", { name: "בית" })).toBeInTheDocument();
  });

  it("keeps a preview onboarding visit on Home", async () => {
    function Place() {
      const location = useLocation();
      return <p>{`${location.pathname}${location.search}`}</p>;
    }
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter initialEntries={["/onboarding?preview=1"]}>
              <Routes>
                <Route path="/onboarding" element={<OnboardingScreen />} />
                <Route path="/" element={<h1>בית</h1>} />
                <Route path="/sign-in" element={<h1>התחברות</h1>} />
              </Routes>
              <Place />
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "חזרה" }));
    expect(await screen.findByRole("heading", { name: "בית" })).toBeInTheDocument();
    expect(screen.getByText("/?preview=1")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "התחברות" })).not.toBeInTheDocument();
  });

  it("shows the error row when the status query is paused and leaves previews disconnected", async () => {
    onlineManager.setOnline(false);
    try {
      rpc.impl = (name) => {
        if (name === "sumit_status") return new Promise(() => undefined);
        return Promise.resolve({ data: null, error: null });
      };
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      client.setQueryData(["dashboard", "off", defaultPeriod()], dashboard);
      client.setQueryData(["categories", "off"], []);
      const { unmount } = render(
        <QueryClientProvider client={client}>
          <ToastProvider>
            <BooksProvider>
              <MemoryRouter>
                <ConnectionsScreen />
              </MemoryRouter>
            </BooksProvider>
          </ToastProvider>
        </QueryClientProvider>,
      );
      const group = await screen.findByRole("group", { name: "SUMIT" });
      expect(within(group).getByText("לא הצלחנו לטעון")).toBeInTheDocument();
      expect(within(group).queryByText("לא מחובר")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "SUMIT" })).not.toBeInTheDocument();
      expect(screen.queryByLabelText("מספר חברה")).not.toBeInTheDocument();
      unmount();

      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider>
            <BooksProvider>
              <MemoryRouter initialEntries={["/settings?preview=1"]}>
                <ConnectionsScreen />
              </MemoryRouter>
            </BooksProvider>
          </ToastProvider>
        </QueryClientProvider>,
      );
      const previewRow = screen.getByRole("button", { name: "SUMIT" });
      expect(document.getElementById(previewRow.getAttribute("aria-describedby") ?? "")).toHaveTextContent("לא מחובר");
      expect(screen.queryByRole("button", { name: "ניסיון חוזר: SUMIT" })).not.toBeInTheDocument();
    } finally {
      onlineManager.setOnline(true);
    }
  });
});
