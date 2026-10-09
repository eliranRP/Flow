import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { ReviewScreen } from "./flow-screens";
import {
  bindJevConnectorScope,
  boundJevConnectorScope,
  jevConnectorQueryKey,
  jevConnectorStorageKey,
  jevScopeFollowsLive,
  readJevConnectorFlag,
  resetJevScopeMemory,
  writeJevConnectorFlag,
} from "./jev-review";

const scope = { userId: "user-1", companyId: "company-1" };

const session = {
  access_token: "test",
  refresh_token: "test",
  expires_in: 3600,
  token_type: "bearer",
  user: {
    id: scope.userId,
    aud: "authenticated",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-09-27T00:00:00Z",
    email: "owner@example.com",
  },
} satisfies Session;

const stored = {
  id: "r1",
  transaction_id: "t1",
  description: "חומרי בניין",
  doc_date: "2026-04-12",
  amount_net: -2_200_000,
  direction: "expense",
  reason: null,
  pnl_role: "project",
  share_count: 1,
  project_id: "p-stored",
  category_id: "c-stored",
  supplier_name: "חומרי בניין לדוגמה בע״מ",
  project_name: "פרויקט שמור",
  category_name: "קטגוריה שמורה",
  project_suggested: false,
  category_suggested: false,
};

const db = vi.hoisted(() => ({
  handlers: [] as Array<(event: string, next: Session | null) => void>,
  holdCompany: null as Promise<void> | null,
  holdIntegration: null as Promise<void> | null,
  companyReads: 0,
  integrationReads: 0,
  reviewReads: 0,
  companyId: "company-1",
  omitCompany: false,
  companyError: false,
  holdSession: null as Promise<void> | null,
  restoreSession: false,
  writes: [] as Array<{ name: string; args?: Record<string, unknown> }>,
  integration: null as { enabled: boolean; mode: string } | null,
  suggestions: [] as Array<{ id: string; transaction_id: string; answers: unknown }>,
  review: [] as unknown[],
  session: null as Session | null,
}));

function chain(ready: () => Promise<{ data: unknown; error: { message: string } | null }>) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => ready(),
    then: (
      onFulfilled: (value: { data: unknown; error: { message: string } | null }) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => ready().then(onFulfilled, onRejected),
  };
  return builder;
}

const supabase = {
  auth: {
    onAuthStateChange: (callback: (event: string, next: Session | null) => void) => {
      db.handlers.push(callback);
      if (db.restoreSession) callback("INITIAL_SESSION", db.session);
      return { data: { subscription: { unsubscribe: () => undefined } } };
    },
    getSession: () => {
      const result = { data: { session: db.session } };
      return db.holdSession == null ? Promise.resolve(result) : db.holdSession.then(() => result);
    },
    signOut: () => Promise.resolve({ error: null }),
  },
  rpc: (name: string, args?: Record<string, unknown>) => {
    if (name === "list_review") {
      db.reviewReads += 1;
      return Promise.resolve({ data: db.review, error: null });
    }
    if (name === "approve_review_item") {
      db.writes.push({ name, args });
      const id = typeof args?.p_id === "string" ? args.p_id : "";
      db.review = db.review.filter((row) => {
        if (row == null || typeof row !== "object" || !("id" in row)) return true;
        return row.id !== id;
      });
      return Promise.resolve({ data: null, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  },
  from: (name: string) => {
    if (name === "companies") {
      db.companyReads += 1;
      return chain(() => {
        const result = db.companyError
          ? { data: null, error: { message: "companies down" } }
          : { data: db.omitCompany ? null : { id: db.companyId }, error: null };
        return db.holdCompany == null ? Promise.resolve(result) : db.holdCompany.then(() => result);
      });
    }
    if (name === "company_integrations") {
      return chain(() => {
        db.integrationReads += 1;
        const result = { data: db.integration, error: null };
        return db.holdIntegration == null ? Promise.resolve(result) : db.holdIntegration.then(() => result);
      });
    }
    if (name === "tag_suggestions") return chain(() => Promise.resolve({ data: db.suggestions, error: null }));
    if (name === "projects") return chain(() => Promise.resolve({ data: [{ id: "p1", name: "וילה רעננה", status: "active" }], error: null }));
    return chain(() => Promise.resolve({ data: [{ id: "c1", name: "חומרים", hidden: false }], error: null }));
  },
};

vi.mock("../lib/supabase", () => ({
  getSupabase: () => supabase,
}));

function renderReview(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AuthProvider>
          <BooksProvider>
            <MemoryRouter initialEntries={["/review"]}>
              <ReviewScreen />
            </MemoryRouter>
          </BooksProvider>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function connectorKeys(client: QueryClient): readonly (readonly unknown[])[] {
  return client.getQueryCache().findAll({ queryKey: ["jev-connector"] }).map((query) => query.queryKey);
}

describe("cold review scope", () => {
  beforeEach(() => {
    db.handlers = [];
    db.holdCompany = null;
    db.holdIntegration = null;
    db.companyReads = 0;
    db.integrationReads = 0;
    db.reviewReads = 0;
    db.companyId = scope.companyId;
    db.omitCompany = false;
    db.companyError = false;
    db.holdSession = null;
    db.restoreSession = false;
    db.writes = [];
    db.integration = null;
    db.suggestions = [];
    db.review = [];
    db.session = session;
    resetJevScopeMemory();
    localStorage.removeItem("flow.jev-connector");
    localStorage.removeItem(jevConnectorStorageKey(scope));
  });

  afterEach(() => {
    resetJevScopeMemory();
    localStorage.removeItem("flow.jev-connector");
    localStorage.removeItem(jevConnectorStorageKey(scope));
  });

  it("waits on a remembered on when /review is opened with no dashboard cache", async () => {
    let releaseCompany: () => void = () => undefined;
    let releaseIntegration: () => void = () => undefined;
    db.holdCompany = new Promise<void>((resolve) => {
      releaseCompany = resolve;
    });
    db.holdIntegration = new Promise<void>((resolve) => {
      releaseIntegration = resolve;
    });
    db.review = [stored];
    db.integration = { enabled: false, mode: "off" };
    localStorage.setItem(jevConnectorStorageKey(scope), "1");
    localStorage.setItem("flow.jev-connector", "1");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderReview(client);
    await waitFor(() => {
      expect(db.reviewReads).toBe(1);
      expect(db.companyReads).toBe(1);
    });
    expect(await screen.findByRole("heading", { name: stored.supplier_name })).toBeInTheDocument();
    expect(screen.queryByText("טוען…")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "אישור" })).toBeDisabled();
    expect(document.querySelector("[data-jev-pending]")).not.toBeNull();
    expect(boundJevConnectorScope()).toBeNull();
    await act(async () => {
      releaseCompany();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(document.querySelector("[data-jev-pending]")).not.toBeNull();
    });
    expect(screen.getByRole("button", { name: "אישור" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "פרויקט: פרויקט שמור" })).toBeInTheDocument();
    expect(screen.queryByText("הצעה")).not.toBeInTheDocument();
    expect(localStorage.getItem("flow.jev-connector")).toBeNull();
    expect(connectorKeys(client)).toContainEqual(["jev-connector", scope.userId, scope.companyId]);
    expect(connectorKeys(client).some((key) => key.length === 1)).toBe(false);
    await act(async () => {
      releaseIntegration();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(document.querySelector("[data-jev-pending]")).toBeNull();
    });
    expect(screen.getByRole("button", { name: "אישור" })).toBeEnabled();
    expect(screen.queryByText("הצעה")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "פרויקט: פרויקט שמור" })).toBeInTheDocument();
  });

  it("uses company_id on the list_review payload when the session has no company row yet", async () => {
    let releaseIntegration: () => void = () => undefined;
    db.holdIntegration = new Promise<void>((resolve) => {
      releaseIntegration = resolve;
    });
    db.omitCompany = true;
    db.review = [{ ...stored, company_id: scope.companyId }];
    db.integration = { enabled: false, mode: "off" };
    localStorage.setItem(jevConnectorStorageKey(scope), "1");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderReview(client);
    await waitFor(() => {
      expect(document.querySelector("[data-jev-pending]")).not.toBeNull();
    });
    expect(boundJevConnectorScope()).toEqual(scope);
    expect(screen.getByRole("button", { name: "אישור" })).toBeDisabled();
    expect(connectorKeys(client).some((key) => key.length === 1)).toBe(false);
    await act(async () => {
      releaseIntegration();
      await Promise.resolve();
    });
  });

  it("does not enable a stored card before the company is known when nothing remembered an on", async () => {
    const enabledWithoutScope: string[] = [];
    const observer = new MutationObserver(() => {
      const button = document.querySelector(".ui-review-approve button");
      if (!(button instanceof HTMLButtonElement) || button.disabled) return;
      if (boundJevConnectorScope() == null) enabledWithoutScope.push("enabled");
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    let releaseCompany: () => void = () => undefined;
    let releaseIntegration: () => void = () => undefined;
    db.holdCompany = new Promise<void>((resolve) => {
      releaseCompany = resolve;
    });
    db.holdIntegration = new Promise<void>((resolve) => {
      releaseIntegration = resolve;
    });
    db.review = [{ ...stored, project_suggested: true, category_suggested: true }];
    db.integration = { enabled: true, mode: "shadow" };
    db.suggestions = [{
      id: "s1",
      transaction_id: "t1",
      answers: {
        project: { choice: "p1", confidence: 0.91 },
        category: { choice: "c1", confidence: 0.88 },
      },
    }];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderReview(client);
    await waitFor(() => {
      expect(db.reviewReads).toBe(1);
      expect(db.companyReads).toBe(1);
    });
    expect(await screen.findByRole("heading", { name: stored.supplier_name })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "אישור" })).toBeDisabled();
    expect(boundJevConnectorScope()).toBeNull();
    await act(async () => {
      releaseCompany();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "אישור" })).toBeEnabled();
    });
    expect(boundJevConnectorScope()).toEqual(scope);
    expect(screen.getByRole("button", { name: "פרויקט: פרויקט שמור, הצעה" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "פרויקט: וילה רעננה, הצעת Jev" })).not.toBeInTheDocument();
    expect(enabledWithoutScope).toEqual([]);
    await act(async () => {
      releaseIntegration();
      await Promise.resolve();
    });
    expect(await screen.findByRole("button", { name: "פרויקט: וילה רעננה, הצעת Jev" })).toBeInTheDocument();
    expect(enabledWithoutScope).toEqual([]);
    expect(connectorKeys(client)).toContainEqual(["jev-connector", scope.userId, scope.companyId]);
    expect(connectorKeys(client).some((key) => key.length === 1)).toBe(false);
    observer.disconnect();
  });

  it("keeps the review connector cache scoped to the user and company", async () => {
    db.review = [stored];
    db.integration = { enabled: false, mode: "off" };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderReview(client);
    await waitFor(() => {
      expect(connectorKeys(client)).toContainEqual(["jev-connector", scope.userId, scope.companyId]);
    });
    expect(connectorKeys(client).some((key) => key.length === 1)).toBe(false);
    expect(client.getQueryData(["jev-connector"])).toBeUndefined();
  });

  it("drops the in-memory connector cache when auth becomes signed out", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    bindJevConnectorScope(scope);
    writeJevConnectorFlag(true, scope);
    client.setQueryData(jevConnectorQueryKey(scope), true);
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <div />
        </AuthProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(db.handlers.length).toBeGreaterThan(0);
    });
    act(() => {
      db.handlers[0]?.("INITIAL_SESSION", session);
    });
    expect(client.getQueryData(jevConnectorQueryKey(scope))).toBe(true);
    act(() => {
      db.handlers[0]?.("SIGNED_OUT", null);
    });
    await waitFor(() => {
      expect(client.getQueryData(jevConnectorQueryKey(scope))).toBeUndefined();
      expect(boundJevConnectorScope()).toBeNull();
    });
    expect(readJevConnectorFlag(scope)).toBe(true);
  });

  it("renders the list while the company lookup is still hanging", async () => {
    db.holdCompany = new Promise<void>(() => undefined);
    db.review = [stored];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderReview(client);
    expect(await screen.findByRole("heading", { name: stored.supplier_name }, { timeout: 800 })).toBeInTheDocument();
    expect(screen.queryByText("טוען…")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "אישור" })).toBeDisabled();
    expect(document.querySelector("[data-jev-pending]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "פרויקט: פרויקט שמור" })).toBeInTheDocument();
    expect(screen.queryByText("הצעה")).not.toBeInTheDocument();
    expect(connectorKeys(client).some((key) => key.length === 1)).toBe(false);
    expect(client.getQueryData(["jev-connector"])).toBeUndefined();
  });

  it("makes the stored card approvable after a hanging lookup once the live read says off", async () => {
    db.holdCompany = new Promise<void>(() => undefined);
    db.integration = { enabled: false, mode: "off" };
    db.review = [stored];
    const started = Date.now();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderReview(client);
    expect(await screen.findByRole("heading", { name: stored.supplier_name }, { timeout: 800 })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "אישור" })).toBeEnabled();
    }, { timeout: 1800 });
    expect(Date.now() - started).toBeLessThan(1800);
    expect(document.querySelector("[data-jev-pending]")).toBeNull();
    expect(screen.getByRole("button", { name: "פרויקט: פרויקט שמור" })).toBeInTheDocument();
    expect(screen.queryByText("הצעה")).not.toBeInTheDocument();
    expect(boundJevConnectorScope()).toBeNull();
    expect(connectorKeys(client).some((key) => key.length === 1)).toBe(false);
    expect(client.getQueryData(["jev-connector"])).toBeUndefined();
  });

  it("binds a company row that arrives after the one-second cap", async () => {
    let releaseCompany: () => void = () => undefined;
    db.holdCompany = new Promise<void>((resolve) => {
      releaseCompany = resolve;
    });
    db.integration = { enabled: false, mode: "off" };
    db.review = [stored];
    const started = Date.now();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderReview(client);
    expect(await screen.findByRole("heading", { name: stored.supplier_name })).toBeInTheDocument();
    const releaseAt = window.setTimeout(() => {
      releaseCompany();
    }, 1500);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "אישור" })).toBeEnabled();
    }, { timeout: 1800 });
    await waitFor(() => {
      expect(boundJevConnectorScope()).toEqual(scope);
    }, { timeout: 2500 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(1400);
    expect(Date.now() - started).toBeLessThan(2500);
    expect(screen.getByRole("button", { name: "אישור" })).toBeEnabled();
    expect(document.querySelector("[data-jev-pending]")).toBeNull();
    expect(screen.queryByText("הצעה")).not.toBeInTheDocument();
    expect(connectorKeys(client).some((key) => key.length === 1)).toBe(false);
    window.clearTimeout(releaseAt);
  });

  it("reads the connector once when the company binds after a live read said on (FLOW-704)", async () => {
    db.restoreSession = true;
    let releaseCompany: () => void = () => undefined;
    db.holdCompany = new Promise<void>((resolve) => {
      releaseCompany = resolve;
    });
    db.integration = { enabled: true, mode: "shadow" };
    db.review = [stored];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderReview(client);
    await waitFor(() => {
      expect(db.integrationReads).toBe(1);
    });
    expect(boundJevConnectorScope()).toBeNull();
    expect(jevScopeFollowsLive()).toBe(false);
    releaseCompany();
    await waitFor(() => {
      expect(boundJevConnectorScope()).toEqual(scope);
    });
    await waitFor(() => {
      expect(client.getQueryData(jevConnectorQueryKey(scope))).toBe(true);
    });
    expect(db.integrationReads).toBe(1);
    expect(readJevConnectorFlag(scope)).toBe(true);
  });

  it("waits on the live read after a company miss when this user remembered an on (FLOW-704)", async () => {
    let releaseIntegration: () => void = () => undefined;
    db.holdIntegration = new Promise<void>((resolve) => {
      releaseIntegration = resolve;
    });
    db.omitCompany = true;
    db.review = [stored];
    db.integration = { enabled: false, mode: "off" };
    localStorage.setItem(jevConnectorStorageKey(scope), "1");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderReview(client);
    expect(await screen.findByRole("heading", { name: stored.supplier_name })).toBeInTheDocument();
    await waitFor(() => {
      expect(jevScopeFollowsLive()).toBe(true);
    });
    // No company, so no remembered flag of its own: the card waits on this session's live read.
    expect(boundJevConnectorScope()).toBeNull();
    expect(document.querySelector("[data-jev-pending]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "אישור" })).toBeDisabled();
    await act(async () => {
      releaseIntegration();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(document.querySelector("[data-jev-pending]")).toBeNull();
    });
    expect(screen.getByRole("button", { name: "אישור" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "פרויקט: פרויקט שמור" })).toBeInTheDocument();
  });

  it("does not show the last user's Jev fill after a user switch without sign-out (FLOW-704)", async () => {
    db.restoreSession = true;
    db.review = [{ ...stored, project_suggested: true, category_suggested: true }];
    db.integration = { enabled: true, mode: "shadow" };
    db.suggestions = [{
      id: "s1",
      transaction_id: "t1",
      answers: {
        project: { choice: "p1", confidence: 0.91 },
        category: { choice: "c1", confidence: 0.88 },
      },
    }];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderReview(client);
    expect(await screen.findByRole("button", { name: "פרויקט: וילה רעננה, הצעת Jev" })).toBeInTheDocument();
    expect(readJevConnectorFlag(scope)).toBe(true);
    const other = { userId: "user-2", companyId: "company-2" };
    const next = { ...session, user: { ...session.user, id: other.userId } };
    db.session = next;
    db.companyId = other.companyId;
    db.integration = { enabled: false, mode: "off" };
    act(() => {
      for (const handler of db.handlers) handler("SIGNED_IN", next);
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "פרויקט: וילה רעננה, הצעת Jev" })).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(boundJevConnectorScope()).toEqual(other);
      expect(client.getQueryData(jevConnectorQueryKey(other))).toBe(false);
    });
    expect(client.getQueryData(jevConnectorQueryKey(scope))).toBeUndefined();
    expect(screen.getByRole("button", { name: "פרויקט: פרויקט שמור, הצעה" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "אישור" })).toBeEnabled();
    localStorage.removeItem(jevConnectorStorageKey(other));
  });

  it("does not list review while getSession has not answered", async () => {
    db.holdSession = new Promise<void>(() => undefined);
    db.integration = { enabled: false, mode: "off" };
    db.review = [stored];
    renderReview(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    await waitFor(() => {
      expect(screen.getByText("טוען…")).toBeInTheDocument();
    });
    expect(db.reviewReads).toBe(0);
    expect(screen.queryByRole("heading", { name: stored.supplier_name })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "אישור" })).not.toBeInTheDocument();
  });

  it("sends one approve when Jev was never enabled and the company lookup fails", async () => {
    db.companyError = true;
    db.integration = { enabled: false, mode: "off" };
    db.review = [stored];
    renderReview(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    const approve = await screen.findByRole("button", { name: "אישור" });
    await waitFor(() => {
      expect(approve).toBeEnabled();
    });
    expect(document.querySelector("[data-jev-pending]")).toBeNull();
    expect(screen.getByRole("button", { name: "פרויקט: פרויקט שמור" })).toBeInTheDocument();
    expect(screen.queryByText("הצעה")).not.toBeInTheDocument();
    fireEvent.click(approve);
    fireEvent.click(approve);
    fireEvent.click(approve);
    await waitFor(() => {
      expect(db.writes.filter((call) => call.name === "approve_review_item")).toHaveLength(1);
    });
  });

  it("approves a tap while an empty company lookup is still waiting on an off connector", async () => {
    db.restoreSession = true;
    db.omitCompany = true;
    db.holdIntegration = new Promise<void>(() => undefined);
    db.integration = { enabled: false, mode: "off" };
    db.review = [stored];
    renderReview(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    await waitFor(() => {
      expect(jevScopeFollowsLive()).toBe(true);
    });
    const approve = await screen.findByRole("button", { name: "אישור" });
    expect(approve).toBeEnabled();
    expect(document.querySelector("[data-jev-pending]")).toBeNull();
    fireEvent.click(approve);
    await waitFor(() => {
      expect(db.writes.filter((call) => call.name === "approve_review_item")).toHaveLength(1);
    });
  });

  it("paints the stored card on the first frame when this user remembered nothing", async () => {
    db.restoreSession = true;
    db.holdCompany = new Promise<void>(() => undefined);
    db.integration = { enabled: false, mode: "off" };
    db.review = [stored];
    const pendingFrames: string[] = [];
    const observer = new MutationObserver(() => {
      if (document.querySelector("[data-jev-pending]")) pendingFrames.push("pending");
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    renderReview(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    expect(await screen.findByRole("heading", { name: stored.supplier_name }, { timeout: 800 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "אישור" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "פרויקט: פרויקט שמור" })).not.toBeInTheDocument();
    expect(screen.getByText("פרויקט שמור")).toBeInTheDocument();
    expect(document.querySelector("[data-jev-pending]")).toBeNull();
    expect(pendingFrames).toEqual([]);
    expect(boundJevConnectorScope()).toBeNull();
    observer.disconnect();
  });

  it("shows no pending frame on the next card after אישור", async () => {
    const second = {
      ...stored,
      id: "r2",
      transaction_id: "t2",
      supplier_name: "עגורני החוף",
      description: "עגורני החוף",
    };
    db.integration = { enabled: false, mode: "off" };
    db.review = [stored, second];
    renderReview(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    const approve = await screen.findByRole("button", { name: "אישור" });
    await waitFor(() => {
      expect(approve).toBeEnabled();
      expect(boundJevConnectorScope()).toEqual(scope);
    });
    const pendingFrames: string[] = [];
    const observer = new MutationObserver(() => {
      if (document.querySelector("[data-jev-pending]")) pendingFrames.push("pending");
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    fireEvent.click(approve);
    expect(await screen.findByRole("heading", { name: "עגורני החוף" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "אישור" })).toBeEnabled();
    expect(pendingFrames).toEqual([]);
    expect(document.querySelector("[data-jev-pending]")).toBeNull();
    observer.disconnect();
  });

  it("does not rebind the old scope when sign-out lands while the company lookup is in flight", async () => {
    let releaseCompany: () => void = () => undefined;
    db.holdCompany = new Promise<void>((resolve) => {
      releaseCompany = resolve;
    });
    db.review = [stored];
    db.integration = { enabled: true, mode: "shadow" };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderReview(client);
    await waitFor(() => {
      expect(db.handlers.length).toBeGreaterThan(0);
    });
    act(() => {
      db.handlers[0]?.("INITIAL_SESSION", session);
    });
    expect(await screen.findByRole("heading", { name: stored.supplier_name })).toBeInTheDocument();
    client.setQueryData(jevConnectorQueryKey(scope), true);
    act(() => {
      db.handlers[0]?.("SIGNED_OUT", null);
    });
    expect(boundJevConnectorScope()).toBeNull();
    expect(client.getQueryData(jevConnectorQueryKey(scope))).toBeUndefined();
    await act(async () => {
      releaseCompany();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(boundJevConnectorScope()).toBeNull();
    expect(client.getQueryData(jevConnectorQueryKey(scope))).toBeUndefined();
    expect(client.getQueryData(["jev-connector"])).toBeUndefined();
  });

  it("drops the connector cache when the signed-in user changes", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <div />
        </AuthProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(db.handlers.length).toBeGreaterThan(0);
    });
    act(() => {
      db.handlers[0]?.("INITIAL_SESSION", session);
    });
    bindJevConnectorScope(scope);
    writeJevConnectorFlag(true, scope);
    client.setQueryData(jevConnectorQueryKey(scope), true);
    const next = {
      ...session,
      user: { ...session.user, id: "user-2" },
    };
    act(() => {
      db.handlers[0]?.("SIGNED_IN", next);
    });
    expect(client.getQueryData(jevConnectorQueryKey(scope))).toBeUndefined();
    expect(boundJevConnectorScope()).toBeNull();
    expect(readJevConnectorFlag(scope)).toBe(true);
  });

  it("keeps the connector cache when the same user refreshes the token", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <div />
        </AuthProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(db.handlers.length).toBeGreaterThan(0);
    });
    act(() => {
      db.handlers[0]?.("INITIAL_SESSION", session);
    });
    bindJevConnectorScope(scope);
    writeJevConnectorFlag(true, scope);
    client.setQueryData(jevConnectorQueryKey(scope), true);
    act(() => {
      db.handlers[0]?.("TOKEN_REFRESHED", session);
    });
    expect(client.getQueryData(jevConnectorQueryKey(scope))).toBe(true);
    expect(boundJevConnectorScope()).toEqual(scope);
    expect(readJevConnectorFlag(scope)).toBe(true);
  });

  it("keeps the connector cache when the first auth event is signed out", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(jevConnectorQueryKey(scope), true);
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <div />
        </AuthProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(db.handlers.length).toBeGreaterThan(0);
    });
    act(() => {
      db.handlers[0]?.("INITIAL_SESSION", null);
    });
    expect(client.getQueryData(jevConnectorQueryKey(scope))).toBe(true);
    expect(boundJevConnectorScope()).toBeNull();
  });
});
