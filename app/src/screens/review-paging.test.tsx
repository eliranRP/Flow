import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { type Session } from "@supabase/supabase-js";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth";
import { renderWithProviders } from "../test-render";
import { ChangeForm, resetReviewListFocus, ReviewScreen } from "./flow-screens";

// FLOW-984: the Review screen across a page boundary, against a fake list_review_page.

type PageArgs = { p_limit: number; p_after_id?: string; p_project?: string; p_item?: string };

const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args?: Record<string, unknown> }>,
  size: 0,
  failPages: false,
  mine: new Set<number>(),
}));

function rowOf(n: number, extra: Record<string, unknown> = {}) {
  const id = `r${String(n).padStart(3, "0")}`;
  return {
    id,
    transaction_id: `t-${id}`,
    description: `ספק ${id}`,
    doc_date: "2026-09-29",
    amount_net: -10_000,
    direction: "expense",
    reason: null,
    project_id: "p1",
    category_id: "c1",
    project_name: "הרצל",
    category_name: "חומרים",
    supplier_name: `ספק ${id}`,
    auto_approved_today: 0,
    ...extra,
  };
}

function pageOf(args: PageArgs) {
  const open = Array.from({ length: rpc.size }, (_, index) => index + 1).filter((n) => rpc.mine.size === 0 || rpc.mine.has(n));
  if (args.p_item != null) {
    const found = open.find((n) => rowOf(n).id === args.p_item);
    return { items: found == null ? [] : [rowOf(found)], total: open.length, next: null };
  }
  const after = args.p_after_id == null ? 0 : Number(args.p_after_id.slice(1));
  const rest = open.filter((n) => n > after);
  const taken = rest.slice(0, args.p_limit);
  const last = taken[taken.length - 1];
  return {
    items: taken.map((n) => rowOf(n)),
    total: open.length,
    next: rest.length > taken.length && last != null ? { doc_date: "2026-09-29", created_at: "2026-09-29T08:00:00+00:00", id: rowOf(last).id } : null,
  };
}

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

const supabase = {
  auth: {
    onAuthStateChange: (callback: (event: string, next: Session | null) => void) => {
      callback("INITIAL_SESSION", session);
      return { data: { subscription: { unsubscribe: () => undefined } } };
    },
    getSession: () => Promise.resolve({ data: { session } }),
    signOut: () => Promise.resolve({ error: null }),
  },
  rpc: (name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> => {
    rpc.calls.push({ name, args });
    if (name === "list_review_page") {
      const asked = args as PageArgs;
      if (rpc.failPages && asked.p_after_id != null) return Promise.resolve({ data: null, error: { message: "db down" } });
      return Promise.resolve({ data: pageOf(asked), error: null });
    }
    if (name === "list_categories") {
      return Promise.resolve({ data: [{ id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: false }], error: null });
    }
    return Promise.resolve({ data: null, error: null });
  },
};

vi.mock("../lib/supabase", () => ({ getSupabase: () => supabase }));

function renderAt(path: string) {
  return renderWithProviders(
    <AuthProvider>
      <Routes>
        <Route path="/review" element={<ReviewScreen />} />
        <Route path="/review/all" element={<ReviewScreen />} />
        <Route path="/review/change" element={<ChangeForm />} />
      </Routes>
    </AuthProvider>,
    { route: path },
  );
}

const reads = () => rpc.calls.filter((call) => call.name === "list_review_page");

/**
 * The all-items list as it shows on the page: a row is found by the name it shows, and the rows are counted.
 * A role query by name walks every link's accessible name (about 0.8 s at 100 rows on jsdom), which ran out
 * the wait on a loaded runner; waiting on the rows the page shows does not depend on the runner's speed.
 */
async function findListRow(name: string): Promise<HTMLAnchorElement> {
  const link = (await screen.findByText(name)).closest("a");
  if (link == null) throw new Error(`${name} is not a row link`);
  return link;
}
const listRows = () => document.querySelectorAll("a.ui-review-all-row").length;

/** The list's end mark is watched by an observer; the test fires it as scrolling would. */
const watching = vi.hoisted(() => ({ callbacks: [] as Array<() => void> }));

beforeEach(() => {
  rpc.size = 120;
  rpc.failPages = false;
  rpc.mine = new Set();
  rpc.calls = [];
  watching.callbacks = [];
  vi.stubGlobal("IntersectionObserver", class {
    private readonly onSee: IntersectionObserverCallback;
    constructor(onSee: IntersectionObserverCallback) { this.onSee = onSee; }
    observe(target: Element) { if (!target.hasAttribute("data-review-more")) return; watching.callbacks.push(() => { this.onSee([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }); }
    disconnect() { /* nothing to stop */ }
    unobserve() { /* nothing to stop */ }
    takeRecords() { return []; }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetReviewListFocus();
});

describe("FLOW-984: the Review screen in pages", () => {
  it("shows the first page of 50 and counts every open item from the server's total", async () => {
    renderAt("/review");
    expect(await screen.findByRole("heading", { name: "ספק r001" })).toBeInTheDocument();
    await waitFor(() => {
      expect(document.querySelector(".ui-review-counter")?.textContent).toBe("פריט 1 מתוך 120");
    });
    expect(reads()).toHaveLength(1);
    expect(reads()[0]?.args).toEqual({ p_limit: 50 });
    expect(screen.getByText(/הבא בתור: ספק r002/)).toBeInTheDocument();
  });

  it("opens a link to a card on a later page by reading that one row", async () => {
    renderAt("/review?item=r090&from=all");
    expect(await screen.findByRole("heading", { name: "ספק r090" })).toBeInTheDocument();
    expect(reads().some((call) => call.args?.p_item === "r090")).toBe(true);
    // The loaded cards follow it, and the screen did not send the owner to the head of the queue.
    expect(screen.getByText(/הבא בתור: ספק r001/)).toBeInTheDocument();
  });

  it("falls back to the head of the queue when the linked card is gone", async () => {
    rpc.mine = new Set(Array.from({ length: 120 }, (_, index) => index + 1).filter((n) => n !== 90));
    renderAt("/review?item=r090&from=all");
    expect(await screen.findByRole("heading", { name: "ספק r001" })).toBeInTheDocument();
  });

  it("lists the loaded items with the server's count and minutes, and loads the next page near the end", async () => {
    renderAt("/review/all");
    expect(await screen.findByText("120 פריטים")).toBeInTheDocument();
    expect(screen.getByText(/כ־40 דקות לכולם/)).toBeInTheDocument();
    await findListRow("ספק r050");
    expect(listRows()).toBe(50);
    await waitFor(() => { expect(watching.callbacks.length).toBeGreaterThan(0); });
    act(() => { watching.callbacks.at(-1)?.(); });
    // The second page is in when the list shows its 100 rows.
    await waitFor(() => { expect(listRows()).toBe(100); });
    await findListRow("ספק r100");
    expect(reads()).toHaveLength(2);
    expect(reads()[1]?.args).toMatchObject({ p_limit: 50, p_after_id: "r050" });
    // The count is the same after the second page.
    expect(screen.getByText("120 פריטים")).toBeInTheDocument();
  });

  it("a list page that fails to load leaves a quiet row with a retry", async () => {
    renderAt("/review/all");
    await findListRow("ספק r050");
    rpc.failPages = true;
    await waitFor(() => { expect(watching.callbacks.length).toBeGreaterThan(0); });
    act(() => { watching.callbacks.at(-1)?.(); });
    expect(await screen.findByText("לא הצלחנו לטעון עוד פריטים")).toBeInTheDocument();
    expect(listRows()).toBe(50);
    rpc.failPages = false;
    fireEvent.click(screen.getByRole("button", { name: "ניסיון חוזר" }));
    await waitFor(() => { expect(listRows()).toBe(100); });
    await findListRow("ספק r100");
    expect(screen.queryByText("לא הצלחנו לטעון עוד פריטים")).not.toBeInTheDocument();
  });

  it("a project filter reads that project's items through the project argument", async () => {
    rpc.size = 30;
    const real = supabase.rpc;
    supabase.rpc = (name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> => {
      if (name === "project_waiting") {
        return Promise.resolve({
          data: Array.from({ length: 30 }, (_, index) => ({
            review_id: rowOf(index + 1).id,
            transaction_id: rowOf(index + 1).transaction_id,
            description: "ספק",
            doc_date: "2026-09-29",
            amount_net: -10_000,
            direction: "expense",
            reason: null,
            project_id: "p1",
            category_id: "c1",
            category_name: "חומרים",
            supplier_name: "ספק",
          })),
          error: null,
        });
      }
      return real(name, args);
    };
    try {
      renderAt("/review?project=p1");
      expect(await screen.findByRole("heading", { name: "ספק r001" })).toBeInTheDocument();
      expect(reads()[0]?.args).toEqual({ p_limit: 50, p_project: "p1" });
    } finally {
      supabase.rpc = real;
    }
  });
});
