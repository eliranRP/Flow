import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "./auth";
import { myCompaniesFor } from "./team-test-support";
import { resetShownCompanyForTests, shownCompanyFor } from "./lib/company-header";
import { RolePreview, useCompanyRole, useHoldOwnerSettings, useHoldWrites, useIsViewer, useWriteGate, VIEWER_NOTE, ViewerNote, ViewerPreview, ViewerScope } from "./use-is-viewer";

const viewerId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted((): {
  userId: string | null;
  ownerId: string | null;
  companyId: string;
  error: { message: string } | null;
  calls: number;
  gate: Promise<void> | null;
  failAt: number;
  memberRole: "viewer" | "editor";
} => ({
  userId: "11111111-1111-4111-8111-111111111111",
  ownerId: "22222222-2222-4222-8222-222222222222",
  companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  error: null,
  calls: 0,
  gate: null,
  failAt: 0,
  memberRole: "viewer",
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
  rpc: async (name: string) => {
    if (name !== "list_my_companies") return { data: null, error: null };
    state.calls += 1;
    if (state.gate) await state.gate;
    if (state.failAt > 0 && state.calls >= state.failAt) {
      return { data: null, error: { message: "denied" } };
    }
    return {
      data: state.error ? null : myCompaniesFor(state.userId, state.ownerId, { companyId: state.companyId, role: state.memberRole }),
      error: state.error,
    };
  },
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
  return client.getQueryCache().getAll().map((query) => query.queryKey).filter((key) => key[0] === "my-companies");
}

function cachedRole(userId: string): { companyId: string; role: string } | undefined {
  const raw = localStorage.getItem("flow-company-role");
  if (raw == null) return undefined;
  const parsed = JSON.parse(raw) as Record<string, { companyId: string; role: string }>;
  return parsed[userId];
}

describe("useIsViewer", () => {
  beforeEach(() => {
    localStorage.clear();
    // Each test is a fresh page load: the shown company starts from storage.
    resetShownCompanyForTests();
    state.userId = viewerId;
    state.ownerId = ownerId;
    state.companyId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    state.error = null;
    state.calls = 0;
    state.gate = null;
    state.failAt = 0;
    state.memberRole = "viewer";
    auth.handlers.length = 0;
  });

  it("is a viewer when the company owner is someone else", async () => {
    const { client } = renderProbe();
    expect(await screen.findByText("viewer")).toBeInTheDocument();
    expect(state.calls).toBe(1);
    expect(ownerKeys(client)).toContainEqual(["my-companies", viewerId]);
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

  it("holds writes when the owner read fails and nothing is cached", async () => {
    state.error = { message: "denied" };
    function Failed() {
      const role = useCompanyRole();
      const gate = useWriteGate("/review");
      const gated = gate === "show" ? "open" : gate === "wait" ? "wait" : "redirect";
      return (
        <ViewerScope>
          <p>{role}</p>
          <p>{gated}</p>
          {role === "owner" ? <button type="button">הוספה</button> : null}
          <ViewerNote />
        </ViewerScope>
      );
    }
    renderProbe(
      <MemoryRouter>
        <Failed />
      </MemoryRouter>,
    );
    expect(await screen.findByText("unknown")).toBeInTheDocument();
    await waitFor(() => {
      expect(state.calls).toBe(1);
    });
    expect(screen.getByText("unknown")).toBeInTheDocument();
    expect(screen.getByText("redirect")).toBeInTheDocument();
    expect(screen.queryByText("owner")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "הוספה" })).not.toBeInTheDocument();
    expect(screen.queryByText("open")).not.toBeInTheDocument();
    expect(screen.getByText(VIEWER_NOTE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ניסיון חוזר" })).toBeInTheDocument();
    state.error = null;
    state.ownerId = viewerId;
    fireEvent.click(screen.getByRole("button", { name: "ניסיון חוזר" }));
    expect(await screen.findByText("owner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "הוספה" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).not.toBeInTheDocument();
  });

  it("uses the last role saved for this user and company", async () => {
    localStorage.setItem("flow-company-role", JSON.stringify({
      [viewerId]: { companyId: state.companyId, role: "owner" },
      [ownerId]: { companyId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", role: "viewer" },
    }));
    state.error = { message: "denied" };
    renderProbe();
    expect(await screen.findByText("owner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "הוספה" })).toBeInTheDocument();
    expect(screen.queryByText("unknown")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).not.toBeInTheDocument();
  });

  it("keeps a cached viewer from the write controls", async () => {
    localStorage.setItem("flow-company-role", JSON.stringify({
      [viewerId]: { companyId: state.companyId, role: "viewer" },
    }));
    state.error = { message: "denied" };
    renderProbe();
    expect(await screen.findByText("viewer")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "הוספה" })).not.toBeInTheDocument();
    expect(screen.queryByText("unknown")).not.toBeInTheDocument();
  });

  it("ignores a role saved for someone else", async () => {
    localStorage.setItem("flow-company-role", JSON.stringify({
      [ownerId]: { companyId: state.companyId, role: "owner" },
    }));
    state.error = { message: "denied" };
    renderProbe();
    expect(await screen.findByText("unknown")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "הוספה" })).not.toBeInTheDocument();
  });

  it("saves the role for this user and company after a successful read", async () => {
    state.ownerId = viewerId;
    renderProbe();
    expect(await screen.findByText("owner")).toBeInTheDocument();
    expect(cachedRole(viewerId)).toEqual({ companyId: state.companyId, role: "owner" });
  });

  it("retries a failed read when the window focuses or reconnects", async () => {
    state.error = { message: "denied" };
    renderProbe();
    expect(await screen.findByText("unknown")).toBeInTheDocument();
    expect(state.calls).toBe(1);
    state.error = null;
    state.ownerId = viewerId;
    fireEvent(window, new Event("focus"));
    expect(await screen.findByText("owner")).toBeInTheDocument();
    expect(state.calls).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("button", { name: "הוספה" })).toBeInTheDocument();
  });

  it("retries a failed read when the browser reconnects", async () => {
    state.error = { message: "denied" };
    renderProbe();
    expect(await screen.findByText("unknown")).toBeInTheDocument();
    const calls = state.calls;
    state.error = null;
    state.ownerId = ownerId;
    fireEvent(window, new Event("online"));
    expect(await screen.findByText("viewer")).toBeInTheDocument();
    expect(state.calls).toBeGreaterThan(calls);
    expect(screen.queryByRole("button", { name: "הוספה" })).not.toBeInTheDocument();
  });

  it("reserves the quiet line while the role is loading", async () => {
    let release: () => void = () => undefined;
    state.gate = new Promise((resolve) => {
      release = resolve;
    });
    renderProbe(
      <ViewerScope>
        <Probe />
        <ViewerNote />
      </ViewerScope>,
    );
    expect(await screen.findByText("loading")).toBeInTheDocument();
    const reserved = document.querySelector(".ui-viewer-note");
    expect(reserved).toBeInstanceOf(HTMLElement);
    expect(reserved).toHaveAttribute("aria-hidden", "true");
    expect(reserved?.textContent).toBe(VIEWER_NOTE);
    release();
    expect(await screen.findByText("viewer")).toBeInTheDocument();
    const note = screen.getByText(VIEWER_NOTE);
    expect(note).not.toHaveAttribute("aria-hidden");
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
    await client.invalidateQueries({ queryKey: ["my-companies", viewerId] });
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
    expect(keys).toContainEqual(["my-companies", ownerId]);
    expect(keys).not.toContainEqual(["my-companies", viewerId]);
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
      expect(ownerKeys(client)).not.toContainEqual(["my-companies", viewerId]);
    });
    expect(screen.getByText("owner")).toBeInTheDocument();
  });
  describe("FLOW-601 roles from list_my_companies", () => {
    function Flags() {
      const role = useCompanyRole();
      const holdWrites = useHoldWrites();
      const holdOwner = useHoldOwnerSettings();
      const viewer = useIsViewer();
      const gate = useWriteGate("/");
      return (
        <ul>
          <li>{role}</li>
          <li>{holdWrites ? "books held" : "books open"}</li>
          <li>{holdOwner ? "owner settings held" : "owner settings open"}</li>
          <li>{viewer ? "is viewer" : "not viewer"}</li>
          <li>{gate === "show" ? "gate open" : gate === "wait" ? "gate wait" : "gate redirect"}</li>
        </ul>
      );
    }

    it("an editor writes the books but not the owner's settings", async () => {
      state.memberRole = "editor";
      renderProbe(<MemoryRouter><Flags /></MemoryRouter>);
      expect(await screen.findByText("editor")).toBeInTheDocument();
      expect(screen.getByText("books open")).toBeInTheDocument();
      expect(screen.getByText("owner settings held")).toBeInTheDocument();
      expect(screen.getByText("not viewer")).toBeInTheDocument();
      expect(screen.getByText("gate open")).toBeInTheDocument();
      expect(cachedRole(viewerId)).toEqual({ companyId: state.companyId, role: "editor" });
    });

    it("an owner holds nothing and a viewer member holds both", async () => {
      state.ownerId = viewerId;
      const { unmount } = renderProbe(<MemoryRouter><Flags /></MemoryRouter>);
      expect(await screen.findByText("owner")).toBeInTheDocument();
      expect(screen.getByText("books open")).toBeInTheDocument();
      expect(screen.getByText("owner settings open")).toBeInTheDocument();
      unmount();
      state.ownerId = ownerId;
      renderProbe(<MemoryRouter><Flags /></MemoryRouter>);
      expect(await screen.findByText("viewer")).toBeInTheDocument();
      expect(screen.getByText("books held")).toBeInTheDocument();
      expect(screen.getByText("owner settings held")).toBeInTheDocument();
      expect(screen.getByText("gate redirect")).toBeInTheDocument();
    });

    it("shows the company the read opened from then on", async () => {
      renderProbe();
      expect(await screen.findByText("viewer")).toBeInTheDocument();
      expect(shownCompanyFor(viewerId)).toBe(state.companyId);
      expect(JSON.parse(localStorage.getItem("flow-shown-company") ?? "{}")).toEqual({ [viewerId]: state.companyId });
    });

    it("does not use a role saved for another company than the one shown", async () => {
      localStorage.setItem("flow-company-role", JSON.stringify({
        [viewerId]: { companyId: state.companyId, role: "owner" },
      }));
      localStorage.setItem("flow-shown-company", JSON.stringify({ [viewerId]: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }));
      state.error = { message: "denied" };
      renderProbe();
      expect(await screen.findByText("unknown")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "הוספה" })).not.toBeInTheDocument();
    });

    it("pins an editor for a story without a companies read", () => {
      renderProbe(
        <RolePreview role="editor">
          <MemoryRouter><Flags /></MemoryRouter>
        </RolePreview>,
      );
      expect(screen.getByText("editor")).toBeInTheDocument();
      expect(screen.getByText("owner settings held")).toBeInTheDocument();
      expect(state.calls).toBe(0);
    });
  });
});
