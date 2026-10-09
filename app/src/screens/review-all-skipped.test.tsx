import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { ViewerPreview } from "../use-is-viewer";
import { ReviewScreen, resetReviewListFocus } from "./flow-screens";


const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args?: unknown }>,
  impl: (_name: string, _args?: unknown): Promise<{ data: unknown; error: { message: string } | null }> =>
    Promise.resolve({ data: null, error: null }),
}));

const supabase = {
  auth: {
    onAuthStateChange: (callback: (event: string, session: Session | null) => void) => {
      callback("INITIAL_SESSION", session);
      return { data: { subscription: { unsubscribe: () => undefined } } };
    },
    getSession: () => Promise.resolve({ data: { session } }),
    signOut: () => Promise.resolve({ error: null }),
  },
  rpc: (name: string, args?: unknown) => {
    rpc.calls.push({ name, args });
    return rpc.impl(name, args);
  },
};

vi.mock("../lib/supabase", () => ({
  getSupabase: () => supabase,
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
    email: "dana@example.com",
  },
} satisfies Session;

function reviewRow(id: string, supplier: string, projectId: string | null, extra: Record<string, unknown> = {}) {
  return {
    id,
    transaction_id: `t-${id}`,
    description: supplier,
    doc_date: "2026-09-29",
    amount_net: -10_000,
    direction: "expense",
    reason: null,
    project_id: projectId,
    category_id: "c1",
    project_name: projectId === "p1" ? "הרצל" : projectId === "p2" ? "וילה" : null,
    category_name: "חומרים",
    supplier_name: supplier,
    doc_kind: "invoice",
    auto_approved_today: 3,
    ...extra,
  };
}

afterEach(() => {
  rpc.calls.length = 0;
  rpc.impl = () => Promise.resolve({ data: null, error: null });
  resetReviewListFocus();
});

function renderWithLine(path: string, options?: { viewer?: boolean }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const routes = (
    <Routes>
      <Route path="/review" element={<ReviewScreen />} />
      <Route path="/review/all" element={<ReviewScreen />} />
      <Route path="/review/change" element={<h1>שינוי</h1>} />
      <Route path="/transactions/:transactionId/split-category" element={<h1>עורך הפיצול</h1>} />
      <Route path="/transactions/:transactionId" element={<h1>תנועה</h1>} />
    </Routes>
  );
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <AuthProvider>
            <BooksProvider>
              {options?.viewer ? <ViewerPreview>{routes}</ViewerPreview> : routes}
            </BooksProvider>
          </AuthProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function skippedRow(id: string, supplier: string) {
  return {
    id,
    transaction_id: `t-${id}`,
    description: supplier,
    doc_date: "2026-09-28",
    doc_kind: "invoice",
    amount_net: -25_000,
    currency: "ILS",
    direction: "expense",
    line_status: "posted",
    source: "sumit",
    project_id: "p1",
    category_id: "c1",
    project_name: "הרצל",
    category_name: "חומרים",
    supplier_name: supplier,
    skipped_at: "2026-09-30T08:00:00Z",
  };
}

describe("the דולגו section under הצגת הכול (FLOW-309)", () => {
  it("lists the skipped rows after the pending ones; a row opens the line; החזרה לתור reopens it", async () => {
    let skipped = [skippedRow("s1", "ברזל ומתכת לדוגמה"), skippedRow("s2", "צבע וגבס")];
    rpc.impl = (name, args) => {
      if (name === "list_review") return Promise.resolve({ data: [reviewRow("r1", "מחסן הנמל", "p1")], error: null });
      if (name === "list_skipped_review") return Promise.resolve({ data: skipped, error: null });
      if (name === "reopen_review") {
        expect(args).toEqual({ p_id: "s1" });
        skipped = skipped.filter((row) => row.id !== "s1");
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    renderWithLine("/review/all");
    const heading = await screen.findByRole("heading", { name: "דולגו" });
    const section = heading.closest("section") as HTMLElement;
    expect(within(section).getByText("2")).toBeInTheDocument();
    const pending = screen.getByRole("link", { name: /מחסן הנמל/ });
    expect(pending.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(section).getByRole("link", { name: /ברזל ומתכת לדוגמה/ })).toHaveAttribute("href", "/transactions/t-s1");
    fireEvent.click(within(section).getByRole("button", { name: "החזרה לתור: ברזל ומתכת לדוגמה" }));
    expect(await screen.findByText("הפריט חזר לתור.")).toBeInTheDocument();
    await waitFor(() => {
      expect(within(section).queryByRole("link", { name: /ברזל ומתכת לדוגמה/ })).toBeNull();
    });
    fireEvent.click(screen.getByRole("button", { name: "לכרטיס" }));
    expect(await screen.findByRole("button", { name: "אישור" })).toBeInTheDocument();
  });

  it("moves focus to the next row's החזרה לתור after a reopen, then to the page heading (FLOW-327 r1)", async () => {
    let skipped = [skippedRow("s1", "ברזל ומתכת לדוגמה"), skippedRow("s2", "צבע וגבס")];
    rpc.impl = (name, args) => {
      if (name === "list_review") return Promise.resolve({ data: [reviewRow("r1", "מחסן הנמל", "p1")], error: null });
      if (name === "list_skipped_review") return Promise.resolve({ data: skipped, error: null });
      if (name === "reopen_review") {
        const id = (args as { p_id: string }).p_id;
        skipped = skipped.filter((row) => row.id !== id);
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    renderWithLine("/review/all");
    const first = await screen.findByRole("button", { name: "החזרה לתור: ברזל ומתכת לדוגמה" });
    first.focus();
    fireEvent.click(first);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "החזרה לתור: צבע וגבס" })).toHaveFocus();
    });
    fireEvent.click(screen.getByRole("button", { name: "החזרה לתור: צבע וגבס" }));
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "דולגו" })).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toHaveClass("ui-focus-title");
    });
  });

  it("says when the reopen failed, reads the list again and offers ניסיון חוזר", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") return Promise.resolve({ data: [reviewRow("r1", "מחסן הנמל", "p1")], error: null });
      if (name === "list_skipped_review") return Promise.resolve({ data: [skippedRow("s1", "ברזל ומתכת לדוגמה")], error: null });
      if (name === "reopen_review") return Promise.resolve({ data: null, error: { message: "review item not found" } });
      return Promise.resolve({ data: null, error: null });
    };
    renderWithLine("/review/all");
    fireEvent.click(await screen.findByRole("button", { name: "החזרה לתור: ברזל ומתכת לדוגמה" }));
    const reads = rpc.calls.filter((call) => call.name === "list_skipped_review").length;
    expect(await screen.findByText("לא הצלחנו להחזיר לתור.")).toBeInTheDocument();
    await waitFor(() => {
      expect(rpc.calls.filter((call) => call.name === "list_skipped_review").length).toBeGreaterThan(reads);
    });
    fireEvent.click(screen.getByRole("button", { name: "ניסיון חוזר" }));
    await waitFor(() => {
      expect(rpc.calls.filter((call) => call.name === "reopen_review")).toHaveLength(2);
    });
  });

  it("shows a viewer the skipped rows with no החזרה לתור and never reopens (FLOW-327 r1)", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") return Promise.resolve({ data: [reviewRow("r1", "מחסן הנמל", "p1")], error: null });
      if (name === "list_skipped_review") return Promise.resolve({ data: [skippedRow("s1", "ברזל ומתכת לדוגמה")], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    renderWithLine("/review/all", { viewer: true });
    const heading = await screen.findByRole("heading", { name: "דולגו" });
    const section = heading.closest("section") as HTMLElement;
    expect(within(section).getByRole("link", { name: /ברזל ומתכת לדוגמה/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /החזרה לתור/ })).toBeNull();
    expect(rpc.calls.some((call) => call.name === "reopen_review")).toBe(false);
  });

  it("renders nothing with no skipped rows, and a read error with ניסיון חוזר", async () => {
    let fail = false;
    rpc.impl = (name) => {
      if (name === "list_review") return Promise.resolve({ data: [reviewRow("r1", "מחסן הנמל", "p1")], error: null });
      if (name === "list_skipped_review") return Promise.resolve(fail ? { data: null, error: { message: "down" } } : { data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    const first = renderWithLine("/review/all");
    expect(await screen.findByRole("link", { name: /מחסן הנמל/ })).toBeInTheDocument();
    await waitFor(() => {
      expect(rpc.calls.some((call) => call.name === "list_skipped_review")).toBe(true);
    });
    expect(screen.queryByRole("heading", { name: "דולגו" })).toBeNull();
    first.unmount();
    fail = true;
    renderWithLine("/review/all");
    expect(await screen.findByText("לא הצלחנו לטעון את הפריטים שדולגו.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "דולגו" })).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "ניסיון חוזר" }));
    await waitFor(() => {
      expect(screen.queryByText("לא הצלחנו לטעון את הפריטים שדולגו.")).toBeNull();
    });
  });

  it("with nothing pending, shows the hint and the skipped rows instead of the empty state", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") return Promise.resolve({ data: [], error: null });
      if (name === "list_skipped_review") return Promise.resolve({ data: [skippedRow("s1", "ברזל ומתכת לדוגמה")], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    renderWithLine("/review/all");
    expect(await screen.findByRole("heading", { name: "דולגו" })).toBeInTheDocument();
    expect(screen.getByText("אין פריטים שמחכים לאישור.")).toBeInTheDocument();
    expect(screen.queryByText("הכל מאושר")).toBeNull();
  });

  it("with nothing pending, shows only the header while the skipped read loads, not הכל מאושר (FLOW-327 r1)", async () => {
    let release: (value: { data: unknown; error: null }) => void = () => undefined;
    rpc.impl = (name) => {
      if (name === "list_review") return Promise.resolve({ data: [], error: null });
      if (name === "list_skipped_review") return new Promise((resolve) => { release = resolve; });
      return Promise.resolve({ data: null, error: null });
    };
    renderWithLine("/review/all");
    expect(await screen.findByText("תנועות שמחכות לשיוך")).toBeInTheDocument();
    await waitFor(() => {
      expect(rpc.calls.some((call) => call.name === "list_skipped_review")).toBe(true);
    });
    expect(screen.queryByText("הכל מאושר")).toBeNull();
    expect(screen.queryByText("אין פריטים שמחכים לאישור.")).toBeNull();
    release({ data: [skippedRow("s1", "ברזל ומתכת לדוגמה")], error: null });
    expect(await screen.findByRole("heading", { name: "דולגו" })).toBeInTheDocument();
    expect(screen.getByText("אין פריטים שמחכים לאישור.")).toBeInTheDocument();
    expect(screen.queryByText("הכל מאושר")).toBeNull();
  });

  it("with nothing pending and nothing skipped, shows the empty state", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") return Promise.resolve({ data: [], error: null });
      if (name === "list_skipped_review") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    renderWithLine("/review/all");
    expect(await screen.findByText("הכל מאושר")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "דולגו" })).toBeNull();
  });
});

describe("the empty queue's link to the skipped cards (FLOW-309, owner pick 2026-10-08)", () => {
  function emptyQueue(skipped: () => Promise<{ data: unknown; error: { message: string } | null }>) {
    rpc.impl = (name) => {
      if (name === "list_review") return Promise.resolve({ data: [], error: null });
      if (name === "list_skipped_review") return skipped();
      return Promise.resolve({ data: null, error: null });
    };
  }

  it("says how many were skipped and opens them under הצגת הכול", async () => {
    emptyQueue(() => Promise.resolve({ data: [skippedRow("s1", "ברזל ומתכת לדוגמה"), skippedRow("s2", "צבע וגבס")], error: null }));
    renderWithLine("/review");
    expect(await screen.findByText("הכל מאושר")).toBeInTheDocument();
    const link = await screen.findByRole("link", { name: "2 פריטים דולגו" });
    expect(link).toHaveAttribute("href", "/review/all#review-skipped");
    expect(link.querySelector("bdi")?.textContent).toBe("2");
    fireEvent.click(link);
    const heading = await screen.findByRole("heading", { name: "דולגו" });
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
  });

  it("says פריט אחד דולג for one", async () => {
    emptyQueue(() => Promise.resolve({ data: [skippedRow("s1", "ברזל ומתכת לדוגמה")], error: null }));
    renderWithLine("/review");
    expect(await screen.findByRole("link", { name: "פריט אחד דולג" })).toBeInTheDocument();
  });

  it("is hidden with nothing skipped, and when the list fails to load", async () => {
    emptyQueue(() => Promise.resolve({ data: [], error: null }));
    const first = renderWithLine("/review");
    expect(await screen.findByText("הכל מאושר")).toBeInTheDocument();
    await waitFor(() => {
      expect(rpc.calls.some((call) => call.name === "list_skipped_review")).toBe(true);
    });
    expect(screen.queryByRole("link", { name: /דולג/ })).toBeNull();
    first.unmount();
    rpc.calls.length = 0;
    emptyQueue(() => Promise.resolve({ data: null, error: { message: "down" } }));
    renderWithLine("/review");
    expect(await screen.findByText("הכל מאושר")).toBeInTheDocument();
    await waitFor(() => {
      expect(rpc.calls.some((call) => call.name === "list_skipped_review")).toBe(true);
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("link", { name: /דולג/ })).toBeNull();
  });
});
