import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./auth";
import { readRoleCache, writeRoleCache } from "./company-role-cache";

const auth = vi.hoisted(() => ({
  handlers: [] as Array<(event: string, session: Session | null) => void>,
}));

vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    auth: {
      onAuthStateChange: (callback: (event: string, session: Session | null) => void) => {
        auth.handlers.push(callback);
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
    },
  }),
}));

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COMPANY_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const COMPANY_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function sessionFor(userId: string): Session {
  return { access_token: `token-${userId}`, user: { id: userId } } as unknown as Session;
}

function emit(event: string, session: Session | null) {
  act(() => {
    for (const handler of auth.handlers) handler(event, session);
  });
}

/** Stands in for the dashboard: its key names no user, like the real one. */
function Books({ fetchFor }: { fetchFor: (userId: string) => Promise<string> }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [draft, setDraft] = useState("");
  const books = useQuery({
    queryKey: ["dashboard", "off", "month"],
    enabled: userId != null,
    queryFn: () => fetchFor(userId ?? ""),
  });
  return (
    <div>
      <p>{books.data ?? "loading"}</p>
      <label>
        note
        <input value={draft} onChange={(event) => { setDraft(event.target.value); }} />
      </label>
    </div>
  );
}

function renderApp(fetchFor: (userId: string) => Promise<string>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Books fetchFor={fetchFor} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return client;
}

const companyOf = (userId: string) => (userId === USER_A ? "company A flag on" : "company B flag off");

describe("per-user cache on a shared device", () => {
  beforeEach(() => {
    auth.handlers.length = 0;
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("sign-out drops the cached books and the saved role", async () => {
    writeRoleCache(USER_A, COMPANY_A, "viewer");
    writeRoleCache(USER_B, COMPANY_B, "owner");
    const client = renderApp((userId) => Promise.resolve(companyOf(userId)));
    emit("INITIAL_SESSION", sessionFor(USER_A));
    expect(await screen.findByText("company A flag on")).toBeInTheDocument();

    emit("SIGNED_OUT", null);

    expect(client.getQueryData(["dashboard", "off", "month"])).toBeUndefined();
    expect(screen.queryByText("company A flag on")).not.toBeInTheDocument();
    expect(readRoleCache(USER_A)).toBeNull();
    // Another person's saved role on this device is theirs to keep.
    expect(readRoleCache(USER_B)).toEqual({ companyId: COMPANY_B, role: "owner" });
  });

  it("an expired session clears the same way as a sign-out", async () => {
    writeRoleCache(USER_A, COMPANY_A, "owner");
    const client = renderApp((userId) => Promise.resolve(companyOf(userId)));
    emit("INITIAL_SESSION", sessionFor(USER_A));
    expect(await screen.findByText("company A flag on")).toBeInTheDocument();

    // A failed refresh, here or in another tab, reaches this tab as a signed-out event.
    emit("SIGNED_OUT", null);

    expect(client.getQueryCache().getAll().filter((query) => query.state.data !== undefined)).toEqual([]);
    expect(readRoleCache(USER_A)).toBeNull();
    expect(localStorage.getItem("flow-company-role")).toBeNull();
  });

  it("a user switch without a reload never shows the last user's company", async () => {
    writeRoleCache(USER_A, COMPANY_A, "viewer");
    let releaseB: (value: string) => void = () => undefined;
    const fetchFor = vi.fn((userId: string) => {
      if (userId === USER_A) return Promise.resolve(companyOf(USER_A));
      return new Promise<string>((resolve) => { releaseB = resolve; });
    });
    renderApp(fetchFor);
    emit("INITIAL_SESSION", sessionFor(USER_A));
    expect(await screen.findByText("company A flag on")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("note"), { target: { value: "draft by A" } });

    emit("SIGNED_IN", sessionFor(USER_B));

    // While B's read is still on its way, nothing of A's is on screen.
    expect(screen.queryByText("company A flag on")).not.toBeInTheDocument();
    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(screen.getByLabelText("note")).toHaveValue("");
    expect(readRoleCache(USER_A)).toBeNull();
    await act(async () => {
      releaseB(companyOf(USER_B));
      await Promise.resolve();
    });
    expect(await screen.findByText("company B flag off")).toBeInTheDocument();
    expect(fetchFor).toHaveBeenLastCalledWith(USER_B);
  });

  it("a token refresh for the same user keeps the cache and the screen", async () => {
    writeRoleCache(USER_A, COMPANY_A, "owner");
    const fetchFor = vi.fn((userId: string) => Promise.resolve(companyOf(userId)));
    const client = renderApp(fetchFor);
    emit("INITIAL_SESSION", sessionFor(USER_A));
    expect(await screen.findByText("company A flag on")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("note"), { target: { value: "draft by A" } });

    emit("TOKEN_REFRESHED", sessionFor(USER_A));

    expect(client.getQueryData(["dashboard", "off", "month"])).toBe("company A flag on");
    expect(screen.getByLabelText("note")).toHaveValue("draft by A");
    expect(readRoleCache(USER_A)).toEqual({ companyId: COMPANY_A, role: "owner" });
    expect(fetchFor).toHaveBeenCalledTimes(1);
  });
});
