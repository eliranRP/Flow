import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth";
import { myCompaniesFor } from "../team-test-support";
import { useSetupViewer } from "./viewer";

const session = {
  access_token: "test",
  refresh_token: "test",
  expires_in: 3600,
  token_type: "bearer",
  user: {
    id: "user-1",
    aud: "authenticated",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-09-27T00:00:00Z",
    email: "owner@example.com",
  },
} satisfies Session;

const gate = vi.hoisted((): { row: { owner_id: string } | null; error: boolean; memberRole: "viewer" | "editor" } => ({
  row: { owner_id: "user-1" },
  error: false,
  memberRole: "viewer",
}));

const supabase = {
  auth: {
    onAuthStateChange: (callback: (event: string, next: Session | null) => void) => {
      callback("INITIAL_SESSION", session);
      return { data: { subscription: { unsubscribe: () => undefined } } };
    },
  },
  rpc: (name: string) => {
    if (name !== "list_my_companies") return Promise.resolve({ data: null, error: null });
    if (gate.error) return Promise.resolve({ data: null, error: { message: "down" } });
    return Promise.resolve({ data: myCompaniesFor("user-1", gate.row?.owner_id ?? null, { role: gate.memberRole }), error: null });
  },
};

vi.mock("../lib/supabase", () => ({
  getSupabase: () => supabase,
}));

function Probe() {
  const viewer = useSetupViewer();
  if (!viewer.ready) return <p>wait</p>;
  return <p>{viewer.viewer ? "viewer" : "owner"}</p>;
}

function renderProbe() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, ...view };
}

describe("setup viewer", () => {
  afterEach(() => {
    gate.row = { owner_id: "user-1" };
    gate.error = false;
    gate.memberRole = "viewer";
    localStorage.clear();
  });

  it("keys the owner read by user and treats the owner as not a viewer", async () => {
    const { client } = renderProbe();
    await waitFor(() => {
      expect(screen.getByText("owner")).toBeInTheDocument();
    });
    const keys = client.getQueryCache().getAll().map((query) => query.queryKey);
    expect(keys).toContainEqual(["my-companies", "user-1"]);
  });

  it("treats a missing company as an owner", async () => {
    gate.row = null;
    renderProbe();
    await waitFor(() => {
      expect(screen.getByText("owner")).toBeInTheDocument();
    });
  });

  it("fails closed when the owner differs", async () => {
    gate.row = { owner_id: "other" };
    renderProbe();
    await waitFor(() => {
      expect(screen.getByText("viewer")).toBeInTheDocument();
    });
  });

  it("fails closed when the owner read errors", async () => {
    gate.error = true;
    renderProbe();
    await waitFor(() => {
      expect(screen.getByText("viewer")).toBeInTheDocument();
    });
  });

  it("keeps an editor out of the run: setup is the owner's (FLOW-601)", async () => {
    gate.row = { owner_id: "other" };
    gate.memberRole = "editor";
    renderProbe();
    await waitFor(() => {
      expect(screen.getByText("viewer")).toBeInTheDocument();
    });
  });
});
