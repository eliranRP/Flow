import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const COMPANY = "3f0c2a52-8b1e-4c3a-9d2e-1a2b3c4d5e6f";

interface MockState {
  companyId: string | null;
  sessionError: boolean;
  homeError: boolean;
  anon: boolean;
  oauth: () => Promise<{ error: null }>;
}

const mock = vi.hoisted((): MockState & { oauth: ReturnType<typeof vi.fn> } => {
  return {
    companyId: "3f0c2a52-8b1e-4c3a-9d2e-1a2b3c4d5e6f",
    sessionError: false,
    homeError: false,
    anon: false,
    oauth: vi.fn(() => Promise.resolve({ error: null })),
  };
});

vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    auth: {
      onAuthStateChange: (callback: (event: string, session: null) => void) => {
        if (mock.anon) {
          queueMicrotask(() => {
            callback("INITIAL_SESSION", null);
          });
        }
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
      getSession: () =>
        Promise.resolve(
          mock.sessionError
            ? { data: { session: null }, error: { message: "boom" } }
            : { data: { session: { user: { id: "u1" } } }, error: null },
        ),
      signInWithOAuth: mock.oauth,
    },
    rpc: () =>
      Promise.resolve(
        mock.homeError
          ? { data: null, error: { message: "boom" } }
          : { data: { company_id: mock.companyId, name: null, net_profit_agorot: 0, is_demo: false }, error: null },
      ),
  }),
}));

function Where() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

function renderAt(path: string, strict = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

async function landsOn(path: string) {
  await waitFor(() => {
    expect(screen.getByTestId("where")).toHaveTextContent(path);
  });
}

afterEach(() => {
  window.sessionStorage.clear();
  mock.companyId = COMPANY;
  mock.sessionError = false;
  mock.homeError = false;
  mock.anon = false;
  mock.oauth.mockClear();
});

describe("auth callback return (FLOW-308)", () => {
  it("returns a known company to the stored screen and clears it", async () => {
    window.sessionStorage.setItem("flow.sign-in-return", "/review");
    renderAt("/auth/callback");
    await landsOn("/review");
    expect(window.sessionStorage.getItem("flow.sign-in-return")).toBeNull();
  });

  it("keeps the stored screen under StrictMode's second effect run", async () => {
    window.sessionStorage.setItem("flow.sign-in-return", "/unpaid");
    renderAt("/auth/callback", true);
    await landsOn("/unpaid");
  });

  it("sends a new account to setup even with a stored screen", async () => {
    mock.companyId = null;
    window.sessionStorage.setItem("flow.sign-in-return", "/review");
    renderAt("/auth/callback");
    await landsOn("/setup/0");
  });

  it("keeps the return on a session error and a get_home error", async () => {
    mock.sessionError = true;
    window.sessionStorage.setItem("flow.sign-in-return", "/review");
    const first = renderAt("/auth/callback");
    await landsOn("/sign-in?error=server_error&return=%2Freview");
    first.unmount();
    mock.sessionError = false;
    mock.homeError = true;
    window.sessionStorage.setItem("flow.sign-in-return", "/review");
    renderAt("/auth/callback");
    await landsOn("/sign-in?error=server_error&return=%2Freview");
  });

  it("stores the listed return when Google sign-in starts", async () => {
    mock.anon = true;
    renderAt("/sign-in?return=%2Freview");
    fireEvent.click(await screen.findByRole("button", { name: /Google/ }));
    await waitFor(() => {
      expect(mock.oauth).toHaveBeenCalled();
    });
    expect(window.sessionStorage.getItem("flow.sign-in-return")).toBe("/review");
  });
});
