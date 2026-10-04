import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "./auth";
import { useCompanyRole, useIsViewer, ViewerPreview } from "./use-is-viewer";

const viewerId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted((): {
  userId: string | null;
  ownerId: string | null;
  error: { message: string } | null;
  calls: number;
  gate: Promise<void> | null;
  failAt: number;
} => ({
  userId: "11111111-1111-4111-8111-111111111111",
  ownerId: "22222222-2222-4222-8222-222222222222",
  error: null,
  calls: 0,
  gate: null,
  failAt: 0,
}));

const auth = vi.hoisted(() => ({
  handlers: [] as Array<(event: string, session: Session | null) => void>,
}));

function sessionFor(id: string | null): Session | null {
  if (id == null) return null;
  return {
    access_token: "test",
    refresh_token: "test",
    expires_in: 3600,
    token_type: "bearer",
    user: {
      id,
      aud: "authenticated",
      app_metadata: {},
      user_metadata: {},
      created_at: "2026-01-01T00:00:00Z",
    },
  };
}

const supabase = vi.hoisted(() => ({
  auth: {
    onAuthStateChange: (callback: (event: string, session: Session | null) => void) => {
      auth.handlers.push(callback);
      callback("INITIAL_SESSION", sessionFor(state.userId));
      return { data: { subscription: { unsubscribe: () => undefined } } };
    },
  },
  from: () => ({
    select: () => ({
      maybeSingle: async () => {
        state.calls += 1;
        if (state.gate) await state.gate;
        if (state.failAt > 0 && state.calls >= state.failAt) {
          return { data: null, error: { message: "denied" } };
        }
        return {
          data: state.ownerId == null ? null : { owner_id: state.ownerId },
          error: state.error,
        };
      },
    }),
  }),
}));

vi.mock("./lib/supabase", () => ({
  getSupabase: () => supabase,
}));

function emit(id: string | null) {
  state.userId = id;
  const session = sessionFor(id);
  for (const handler of auth.handlers) handler(id == null ? "SIGNED_OUT" : "SIGNED_IN", session);
}

function Probe() {
  const role = useCompanyRole();
  return (
    <div>
      <p>{role}</p>
      {role === "owner" ? <button type="button">הוספה</button> : null}
    </div>
  );
}

function renderProbe(node: ReactNode = <Probe />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <AuthProvider>{node}</AuthProvider>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

function ownerKeys(client: QueryClient): ReadonlyArray<readonly unknown[]> {
  return client.getQueryCache().getAll().map((query) => query.queryKey).filter((key) => key[0] === "company-owner");
}

describe("useIsViewer", () => {
  beforeEach(() => {
    state.userId = viewerId;
    state.ownerId = ownerId;
    state.error = null;
    state.calls = 0;
    state.gate = null;
    state.failAt = 0;
    auth.handlers.length = 0;
  });

  it("is a viewer when the company owner is someone else", async () => {
    const { client } = renderProbe();
    expect(await screen.findByText("viewer")).toBeInTheDocument();
    expect(state.calls).toBe(1);
    expect(ownerKeys(client)).toContainEqual(["company-owner", viewerId]);
    expect(ownerKeys(client).some((key) => key.length === 1)).toBe(false);
    expect(screen.queryByRole("button", { name: "הוספה" })).not.toBeInTheDocument();
  });

  it("is not a viewer when this session owns the company", async () => {
    state.ownerId = viewerId;
    renderProbe();
    await waitFor(() => {
      expect(state.calls).toBe(1);
      expect(screen.getByText("owner")).toBeInTheDocument();
      expect(screen.queryByText("loading")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "הוספה" })).toBeInTheDocument();
  });

  it("stays an owner when the company row is missing", async () => {
    state.ownerId = null;
    renderProbe();
    await waitFor(() => {
      expect(state.calls).toBe(1);
      expect(screen.getByText("owner")).toBeInTheDocument();
      expect(screen.queryByText("loading")).not.toBeInTheDocument();
    });
  });

  it("holds writes when the owner read fails", async () => {
    state.error = { message: "denied" };
    renderProbe();
    expect(await screen.findByText("loading")).toBeInTheDocument();
    await waitFor(() => {
      expect(state.calls).toBe(1);
    });
    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(screen.queryByText("viewer")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "הוספה" })).not.toBeInTheDocument();
  });

  it("pins a viewer without a session or a companies read", () => {
    function Flag() {
      const viewer = useIsViewer();
      return <p>{viewer ? "viewer" : "owner"}</p>;
    }
    renderProbe(
      <ViewerPreview>
        <Flag />
      </ViewerPreview>,
    );
    expect(screen.getByText("viewer")).toBeInTheDocument();
    expect(state.calls).toBe(0);
  });

  it.each([
    ["V34", "a delayed owner read hides the write control"],
    ["V36", "a failed refresh keeps the owner"],
  ] as const)("%s %s", async (id, _title) => {
    if (id === "V34") {
      let release: () => void = () => undefined;
      state.gate = new Promise((resolve) => {
        release = resolve;
      });
      renderProbe();
      expect(await screen.findByText("loading")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "הוספה" })).not.toBeInTheDocument();
      expect(state.calls).toBe(1);
      release();
      expect(await screen.findByText("viewer")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "הוספה" })).not.toBeInTheDocument();
      return;
    }
    state.ownerId = viewerId;
    state.failAt = 2;
    const { client } = renderProbe();
    await waitFor(() => {
      expect(state.calls).toBe(1);
      expect(screen.getByText("owner")).toBeInTheDocument();
    });
    await client.invalidateQueries({ queryKey: ["company-owner", viewerId] });
    await waitFor(() => {
      expect(state.calls).toBeGreaterThanOrEqual(2);
    });
    expect(screen.getByText("owner")).toBeInTheDocument();
    expect(screen.queryByText("viewer")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "הוספה" })).toBeInTheDocument();
  });

  it("shows an owner who signs in after a viewer, and drops the previous key", async () => {
    const { client } = renderProbe();
    expect(await screen.findByText("viewer")).toBeInTheDocument();
    state.ownerId = ownerId;
    emit(ownerId);
    await waitFor(() => {
      expect(screen.getByText("owner")).toBeInTheDocument();
      expect(screen.queryByText("viewer")).not.toBeInTheDocument();
    });
    const keys = ownerKeys(client);
    expect(keys).toContainEqual(["company-owner", ownerId]);
    expect(keys).not.toContainEqual(["company-owner", viewerId]);
    expect(screen.getByRole("button", { name: "הוספה" })).toBeInTheDocument();
  });

  it("remounts an owner from the cache without a loading frame", async () => {
    state.ownerId = viewerId;
    const { client, unmount } = renderProbe();
    await waitFor(() => {
      expect(state.calls).toBe(1);
      expect(screen.getByText("owner")).toBeInTheDocument();
    });
    unmount();
    let first = "";
    function Snap() {
      const role = useCompanyRole();
      if (first === "") first = role;
      return <p>{role}</p>;
    }
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <Snap />
        </AuthProvider>
      </QueryClientProvider>,
    );
    expect(first).toBe("owner");
    expect(screen.getByText("owner")).toBeInTheDocument();
    expect(screen.queryByText("loading")).not.toBeInTheDocument();
  });

  it("clears the owner key when the session signs out", async () => {
    const { client } = renderProbe();
    expect(await screen.findByText("viewer")).toBeInTheDocument();
    emit(null);
    await waitFor(() => {
      expect(ownerKeys(client)).not.toContainEqual(["company-owner", viewerId]);
    });
    expect(screen.getByText("owner")).toBeInTheDocument();
  });
});
