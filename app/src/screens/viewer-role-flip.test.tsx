import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { StepBusiness } from "../setup/steps";
import { AddForm, CategoriesScreen, ConnectionsScreen, ProjectsScreen } from "./flow-screens";
import { BusinessScreen } from "./business-screen";
import { ConnectionDetailPage } from "./connection-pages";
import type { SettingsSample } from "./settings-screen";

// FLOW-507 and FLOW-506. The outer gate hides or disables a write control for a viewer (viewer-writes.test.tsx).
// The inner gate is the check inside the handler. It is reached when the role changes while a
// sheet or form is already open: the owner opens it, the role read then settles on viewer (or
// fails with nothing saved), and Enter still submits the form. Each case has an owner control
// that writes, so a form that never reaches the handler cannot pass for a held write.

const role = vi.hoisted(() => {
  let value: "owner" | "viewer" | "unknown" | "loading" = "owner";
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: typeof value) => {
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
});

vi.mock("../use-is-viewer", async (original) => {
  const real = await original<typeof import("../use-is-viewer")>();
  const { createElement, useSyncExternalStore } = await import("react");
  const { Navigate } = await import("react-router-dom");
  const useRole = () => useSyncExternalStore(role.subscribe, role.get);
  return {
    ...real,
    useCompanyRole: useRole,
    useIsViewer: () => useRole() === "viewer",
    useHoldWrites: () => useRole() !== "owner",
    // FLOW-601: the owner's settings (connectors, the name, setup) hold for anyone else.
    useHoldOwnerSettings: () => useRole() !== "owner",
    // The same rule as the real gate, on the test role.
    useWriteGate: (fallback: string) => {
      const now = useRole();
      if (now === "viewer" || now === "unknown") return createElement(Navigate, { to: fallback, replace: true });
      return now === "loading" ? "wait" : "show";
    },
  };
});

const invoke = vi.hoisted(() => vi.fn());
vi.mock("../edge", async (original) => ({
  ...(await original<typeof import("../edge")>()),
  invokeEdge: invoke,
}));

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../lib/supabase", async (original) => ({
  ...(await original<typeof import("../lib/supabase")>()),
  getSupabase: () => ({ rpc }),
}));

const disconnected: SettingsSample = {
  name: "אלפא",
  connected: false,
  companyId: null,
  lastError: null,
  email: "dana@example.com",
  assistant: { state: "empty" },
  jev: { enabled: false, mode: "shadow", threshold: 0.9, status: "ready" },
};

function renderAt(node: ReactNode, path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BooksProvider>
          <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
        </BooksProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function flip(next: "viewer" | "unknown") {
  act(() => { role.set(next); });
}

function formIn(dialog: HTMLElement): HTMLFormElement {
  const form = dialog.querySelector("form");
  if (!(form instanceof HTMLFormElement)) throw new Error("no form in the sheet");
  return form;
}

afterEach(() => {
  role.set("owner");
  invoke.mockReset();
  rpc.mockReset();
});

describe("inner write gates after the role changes", () => {
  describe("new project form", () => {
    async function openAndType() {
      rpc.mockResolvedValue({ data: "p1", error: null });
      renderAt(<ProjectsScreen sample={{ projects: [] } as never} />, "/projects");
      fireEvent.click(screen.getByRole("button", { name: "פרויקט חדש" }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText("שם הפרויקט"), { target: { value: "פרויקט לדוגמה" } });
      return dialog;
    }

    it("saves for an owner", async () => {
      const dialog = await openAndType();
      fireEvent.submit(formIn(dialog));
      await vi.waitFor(() => { expect(rpc).toHaveBeenCalledWith("upsert_project", expect.objectContaining({ p_name: "פרויקט לדוגמה" })); });
    });

    it.each(["viewer", "unknown"] as const)("writes nothing once the role is %s", async (next) => {
      const dialog = await openAndType();
      flip(next);
      expect(within(dialog).getByRole("button", { name: "יצירת פרויקט" })).toBeDisabled();
      fireEvent.submit(formIn(dialog));
      await new Promise((resolve) => setTimeout(resolve, 50));
      // The list reads projects_cash_month through rpc too; only a write is refused.
      expect(rpc).not.toHaveBeenCalledWith("upsert_project", expect.anything());
    });
  });

  describe("SUMIT connect form (FLOW-512 page)", () => {
    function openAndFill() {
      invoke.mockResolvedValue({ data: { ok: true }, error: null });
      renderAt(<ConnectionDetailPage provider="sumit" sample={{ state: "new" }} />, "/settings/connections/sumit");
      fireEvent.change(screen.getByLabelText("מספר חברה"), { target: { value: "1234567" } });
      fireEvent.change(screen.getByLabelText("מפתח API"), { target: { value: "sample-key" } });
      return screen.getByRole("button", { name: "חיבור" });
    }

    it("connects for an owner", async () => {
      fireEvent.click(openAndFill());
      await vi.waitFor(() => { expect(invoke).toHaveBeenCalled(); });
    });

    it.each(["viewer", "unknown"] as const)("sends nothing once the role is %s, and the form is gone", async (next) => {
      openAndFill();
      flip(next);
      expect(screen.queryByRole("button", { name: "חיבור" })).not.toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(invoke).not.toHaveBeenCalled();
    });
  });
  describe("SUMIT status page (FLOW-512)", () => {

    function openStatus() {
      invoke.mockResolvedValue({ data: { ok: true }, error: null });
      rpc.mockResolvedValue({ data: null, error: null });
      renderAt(<ConnectionDetailPage provider="sumit" sample={{ state: "connected", companyId: "1234567" }} />, "/settings/connections/sumit");
      return screen.getByRole("button", { name: "רענון עכשיו" });
    }

    function writes() {
      return invoke.mock.calls.length + rpc.mock.calls.length;
    }

    it("refreshes for an owner", async () => {
      fireEvent.click(openStatus());
      await vi.waitFor(() => { expect(writes()).toBeGreaterThan(0); });
    });

    it("hides the refresh once the role is viewer, so nothing is sent", async () => {
      openStatus();
      flip("viewer");
      expect(screen.queryByRole("button", { name: "רענון עכשיו" })).not.toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(writes()).toBe(0);
    });

    it("asks to disconnect for an owner, and disconnects on confirm", async () => {
      openStatus();
      fireEvent.click(screen.getByRole("button", { name: "ניתוק" }));
      const confirm = await screen.findByRole("dialog", { name: "לנתק את SUMIT?" });
      fireEvent.click(within(confirm).getByRole("button", { name: "ניתוק" }));
      await vi.waitFor(() => { expect(writes()).toBeGreaterThan(0); });
    });
  });
  describe("category menu and new category", () => {
    const rows = [{ id: "c1", name: "חומרים", kind: "expense" as const, hidden: false, is_default: false, count: 1 }];

    async function openMenu() {
      rpc.mockResolvedValue({ data: null, error: null });
      renderAt(<CategoriesScreen sample={rows} />, "/settings/categories");
      fireEvent.click(screen.getByRole("button", { name: /^חומרים/ }));
      return screen.findByRole("dialog", { name: "חומרים" });
    }

    it("keeps a category out of profit for an owner", async () => {
      const dialog = await openMenu();
      fireEvent.click(within(dialog).getByRole("button", { name: "לא לספור ברווח" }));
      await vi.waitFor(() => { expect(rpc).toHaveBeenCalledWith("set_category_excluded_from_pnl", expect.anything()); });
    });

    it("writes nothing from an open menu once the role is viewer", async () => {
      const dialog = await openMenu();
      flip("viewer");
      fireEvent.click(within(dialog).getByRole("button", { name: "לא לספור ברווח" }));
      fireEvent.click(within(dialog).getByRole("switch", { name: "נספרת בשיפוץ" }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(rpc).not.toHaveBeenCalled();
    });

    async function openCreate() {
      rpc.mockResolvedValue({ data: "c2", error: null });
      renderAt(<CategoriesScreen sample={rows} />, "/settings/categories");
      fireEvent.click(screen.getByRole("button", { name: "קטגוריה חדשה" }));
      const dialog = await screen.findByRole("dialog", { name: "קטגוריה חדשה" });
      fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "הובלה" } });
      return dialog;
    }

    it("creates a category for an owner", async () => {
      const dialog = await openCreate();
      fireEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));
      await vi.waitFor(() => { expect(rpc).toHaveBeenCalled(); });
    });

    it("creates nothing once the role is viewer", async () => {
      const dialog = await openCreate();
      flip("viewer");
      fireEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(rpc).not.toHaveBeenCalled();
    });
  });

  describe("setup business step (FLOW-506)", () => {
    function show() {
      rpc.mockResolvedValue({ data: "company-1", error: null });
      renderAt(<StepBusiness companyId={null} initial={{ name: "עסק לדוגמה", currency: "ILS", basis: "paid" }} onDone={() => undefined} onStamp={() => undefined} onSkipStep={() => undefined} onSkipAll={() => undefined} />, "/setup/welcome");
      return screen.getByRole("button", { name: "המשך" });
    }

    it("creates the company for an owner", async () => {
      fireEvent.click(show());
      await vi.waitFor(() => { expect(rpc).toHaveBeenCalledWith("create_company", expect.anything()); });
    });

    it.each(["viewer", "unknown"] as const)("creates nothing once the role is %s", async (next) => {
      const submit = show();
      flip(next);
      fireEvent.click(submit);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(rpc).not.toHaveBeenCalled();
    });
  });

  describe("Business and Jev switches", () => {
    it("locks the overhead and Jev switches once the role is viewer, and a tap changes nothing", () => {
      renderAt(<><BusinessScreen sample={disconnected} /><ConnectionsScreen sample={disconnected} /></>, "/settings/business");
      const overhead = screen.getByRole("switch", { name: "רווח אחרי הוצאות כלליות" });
      const jev = screen.getByRole("switch", { name: "תיוג חכם (Jev)" });
      expect(overhead).not.toHaveAttribute("aria-disabled", "true");
      expect(jev).toBeEnabled();
      const before = [(overhead as HTMLInputElement).checked, (jev as HTMLInputElement).checked];
      flip("viewer");
      expect(overhead).toHaveAttribute("aria-disabled", "true");
      expect(jev).toBeDisabled();
      fireEvent.click(overhead);
      fireEvent.click(jev);
      expect([(overhead as HTMLInputElement).checked, (jev as HTMLInputElement).checked]).toEqual(before);
      expect(rpc).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
    });
  });
  describe("Mercury connect form (FLOW-512 page)", () => {
    function openAndFill() {
      invoke.mockResolvedValue({ data: { ok: true }, error: null });
      renderAt(<ConnectionDetailPage provider="mercury" sample={{ state: "new" }} />, "/settings/connections/mercury");
      fireEvent.change(screen.getByLabelText("מפתח API"), { target: { value: "sample-key" } });
      return screen.getByRole("button", { name: "חיבור" });
    }

    it("connects for an owner", async () => {
      fireEvent.click(openAndFill());
      await vi.waitFor(() => { expect(invoke).toHaveBeenCalled(); });
    });

    it("sends nothing once the role is viewer", async () => {
      openAndFill();
      flip("viewer");
      expect(screen.queryByRole("button", { name: "חיבור" })).not.toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(invoke).not.toHaveBeenCalled();
    });
  });

  describe("the + sheet", () => {
    function show() {
      renderAt(
        <Routes>
          <Route path="/add" element={<AddForm bank="off" />} />
          <Route path="/" element={<h1>בית</h1>} />
        </Routes>,
        "/add",
      );
    }

    it("stays open for an owner", () => {
      show();
      expect(screen.getByRole("dialog", { name: "הוספה" })).toBeInTheDocument();
    });

    it("leaves for Home once the role is viewer", () => {
      show();
      flip("viewer");
      expect(screen.getByRole("heading", { name: "בית" })).toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: "הוספה" })).not.toBeInTheDocument();
    });
  });
});
