import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "./auth";
import { useIsViewer, ViewerPreview } from "./use-is-viewer";

const viewerId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted((): {
  userId: string;
  ownerId: string | null;
  error: { message: string } | null;
  calls: number;
} => ({
  userId: "11111111-1111-4111-8111-111111111111",
  ownerId: "22222222-2222-4222-8222-222222222222",
  error: null,
  calls: 0,
}));

const supabase = vi.hoisted(() => ({
  auth: {
    onAuthStateChange: (callback: (event: string, session: Session | null) => void) => {
      callback("INITIAL_SESSION", {
        access_token: "test",
        refresh_token: "test",
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: state.userId,
          aud: "authenticated",
          app_metadata: {},
          user_metadata: {},
          created_at: "2026-01-01T00:00:00Z",
        },
      });
      return { data: { subscription: { unsubscribe: () => undefined } } };
    },
  },
  from: () => ({
    select: () => ({
      maybeSingle: () => {
        state.calls += 1;
        return Promise.resolve({
          data: state.ownerId == null ? null : { owner_id: state.ownerId },
          error: state.error,
        });
      },
    }),
  }),
}));

vi.mock("./lib/supabase", () => ({
  getSupabase: () => supabase,
}));

function Probe() {
  const viewer = useIsViewer();
  return <p>{viewer ? "viewer" : "owner"}</p>;
}

function renderProbe(node: ReactNode = <Probe />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>{node}</AuthProvider>
    </QueryClientProvider>,
  );
}

describe("useIsViewer", () => {
  beforeEach(() => {
    state.userId = viewerId;
    state.ownerId = ownerId;
    state.error = null;
    state.calls = 0;
  });

  it("is a viewer when the company owner is someone else", async () => {
    renderProbe();
    expect(await screen.findByText("viewer")).toBeInTheDocument();
    expect(state.calls).toBe(1);
  });

  it("is not a viewer when this session owns the company", async () => {
    state.ownerId = viewerId;
    renderProbe();
    await waitFor(() => {
      expect(state.calls).toBe(1);
    });
    expect(screen.getByText("owner")).toBeInTheDocument();
  });

  it("stays an owner when the company row is missing or the read fails", async () => {
    state.ownerId = null;
    renderProbe();
    await waitFor(() => {
      expect(state.calls).toBe(1);
    });
    expect(screen.getByText("owner")).toBeInTheDocument();

    state.ownerId = ownerId;
    state.error = { message: "denied" };
    state.calls = 0;
    renderProbe();
    await waitFor(() => {
      expect(state.calls).toBe(1);
    });
    expect(screen.getAllByText("owner").length).toBeGreaterThan(0);
  });

  it("pins a viewer without a session or a companies read", () => {
    renderProbe(
      <ViewerPreview>
        <Probe />
      </ViewerPreview>,
    );
    expect(screen.getByText("viewer")).toBeInTheDocument();
    expect(state.calls).toBe(0);
  });
});
