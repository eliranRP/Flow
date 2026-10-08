import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import * as supabaseModule from "../lib/supabase";
import type { Dashboard, ReviewRow } from "@flow/shared";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { TabBar } from "../ui/tab-bar";
import { VIEWER_NOTE, ViewerPreview } from "../use-is-viewer";
import { HomeScreen } from "./HomeScreen";
import {
  AddForm,
  CategoriesScreen,
  ChangeForm,
  ConnectionsScreen,
  OnboardingScreen,
  ProjectDetailScreen,
  ProjectsScreen,
  ReviewQueue,
  SettingsScreen,
  SplitScreen,
  TransactionScreen,
} from "./flow-screens";

const reviewRow: ReviewRow = {
  id: "r1",
  transaction_id: "t1",
  description: "חשבונית",
  doc_date: "2026-09-21",
  amount_net: -10_000n,
  direction: "expense",
  reason: null,
  project_id: "p1",
  category_id: "c1",
  supplier_name: "אלפא",
  project_name: "פרויקט א",
  category_name: "חומרים",
  project_suggested: true,
  category_suggested: true,
};

function renderScreen(node: ReactNode, path = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

describe("viewer write controls", () => {
  it("keeps approve on the queue for an owner", () => {
    renderScreen(<ReviewQueue rows={[reviewRow]} search="" sample />);
    expect(screen.getByText(/מתוך/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "אישור" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "שינוי" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "דלג" })).toBeInTheDocument();
  });

  it("hides review writes and category edits", () => {
    renderScreen(
      <ViewerPreview>
        <ReviewQueue rows={[reviewRow]} search="" sample />
      </ViewerPreview>,
    );
    expect(screen.queryByRole("button", { name: "אישור" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "שינוי" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "דלג" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /פרויקט:/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /קטגוריה:/ })).not.toBeInTheDocument();
    expect(screen.getByText("פרויקט א")).toBeInTheDocument();
  });

  it("hides a new category and the row menu", () => {
    renderScreen(
      <ViewerPreview>
        <CategoriesScreen
          sample={[{ id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: true, count: 1 }]}
        />
      </ViewerPreview>,
    );
    expect(screen.getByText("חומרים")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "קטגוריה חדשה" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /עוד, חומרים/ })).not.toBeInTheDocument();
  });

  it("disables settings writes and connect", () => {
    renderScreen(
      <ViewerPreview>
        <SettingsScreen
          sample={{
            name: "אלפא",
            connected: false,
            companyId: null,
            lastError: null,
            email: "dana@example.com",
            assistant: { state: "empty" },
            jev: { enabled: false, mode: "shadow", threshold: 0.9, status: "ready" },
          }}
        />
        <ConnectionsScreen
          sample={{
            name: "אלפא",
            connected: false,
            companyId: null,
            lastError: null,
            email: "dana@example.com",
            assistant: { state: "empty" },
            jev: { enabled: false, mode: "shadow", threshold: 0.9, status: "ready" },
          }}
        />
      </ViewerPreview>,
    );
    expect(screen.getByText("SUMIT")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /SUMIT/ })).not.toBeInTheDocument();
    expect(screen.getByText("עוזר AI")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /עוזר AI/ })).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "רווח אחרי כלליות" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "תיוג חכם (Jev)" })).toBeDisabled();
    // FLOW-501: reading is allowed, so both pages stay a tap away.
    expect(screen.getByRole("link", { name: "חיבורים" })).toHaveAttribute("href", "/settings/connections");
    expect(screen.getByRole("link", { name: "הלוואות" })).toHaveAttribute("href", "/settings/loans");
    // FLOW-504: the viewer reads the company currency and cannot change it.
    expect(screen.getByText("מטבע העסק")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /מטבע העסק/ })).not.toBeInTheDocument();
  });

  it("lets the owner open the company currency sheet from Settings (FLOW-504)", async () => {
    renderScreen(
      <SettingsScreen
        sample={{ name: "אלפא", connected: false, companyId: null, lastError: null, email: "dana@example.com", loanCurrency: "USD" }}
      />,
    );
    const row = screen.getByRole("button", { name: "מטבע העסק: $ דולר" });
    row.click();
    expect(await screen.findByRole("dialog", { name: "מטבע העסק" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "$ דולר" })).toHaveAttribute("aria-checked", "true");
  });
});

const txn = {
  id: "t1",
  description: "חשבונית",
  direction: "expense",
  doc_date: "2026-09-12",
  amount_gross: -118n,
  amount_net: -100n,
  vat_amount: -18n,
  vat_status: "assumed",
  source: "manual",
  project_name: "שיפוץ",
  category_name: "חומרים",
  supplier_name: "ספק",
  customer_name: null,
};

const project = {
  id: "p1",
  name: "שיפוץ",
  status: "active",
  state_label: "פעיל",
  budget_agorot: null,
  income_agorot: 0n,
  direct_agorot: 0n,
  shared_agorot: 0n,
  profit_agorot: 0n,
  categories: [],
  transactions: [],
};

function viewer(node: ReactNode, path = "/") {
  renderScreen(<ViewerPreview>{node}</ViewerPreview>, path);
}

describe("viewer gates", () => {
  it.each([
    ["V09", "review skip stays off the card", () => {
      viewer(<ReviewQueue rows={[reviewRow]} search="" sample />);
      expect(screen.queryByRole("button", { name: "דלג" })).not.toBeInTheDocument();
    }],
    ["V14", "transaction project row is static", () => {
      viewer(<TransactionScreen sample={txn} />);
      expect(screen.getByText("שיפוץ")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /פרויקט/ })).not.toBeInTheDocument();
    }],
    ["V15", "transaction category row is static", () => {
      viewer(<TransactionScreen sample={txn} />);
      expect(screen.getByText("חומרים")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /קטגוריה/ })).not.toBeInTheDocument();
    }],
    ["V16", "split stays off the transaction", () => {
      viewer(<TransactionScreen sample={txn} />);
      expect(screen.queryByRole("button", { name: "פיצול בין פרויקטים" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "פיצול בין פרויקטים" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "עוד" })).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "הוצאה" })).toBeInTheDocument();
      const slot = document.querySelector(".ui-menu-slot");
      expect(slot).toBeInstanceOf(HTMLElement);
      expect(slot).toHaveAttribute("aria-hidden", "true");
    }],
    ["V18", "add leaves the screen", () => {
      viewer(
        <Routes>
          <Route path="/add" element={<AddForm />} />
          <Route path="/" element={<h1>בית</h1>} />
        </Routes>,
        "/add",
      );
      expect(screen.getByRole("heading", { name: "בית" })).toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: "הוספה" })).not.toBeInTheDocument();
    }],
    ["V19", "review change leaves the screen", () => {
      viewer(
        <Routes>
          <Route path="/review/change" element={<ChangeForm />} />
          <Route path="/review" element={<h1>תור</h1>} />
        </Routes>,
        "/review/change?item=r1",
      );
      expect(screen.getByRole("heading", { name: "תור" })).toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: "שינוי שיוך" })).not.toBeInTheDocument();
    }],
    ["V20", "split route leaves the screen", () => {
      viewer(
        <Routes>
          <Route path="/transactions/:transactionId/split" element={<SplitScreen />} />
          <Route path="/transactions/:transactionId" element={<h1>תנועה</h1>} />
        </Routes>,
        "/transactions/t1/split",
      );
      expect(screen.getByRole("heading", { name: "תנועה" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "פיצול בין פרויקטים" })).not.toBeInTheDocument();
    }],
    ["V21", "onboarding leaves the screen", () => {
      viewer(
        <Routes>
          <Route path="/onboarding" element={<OnboardingScreen />} />
          <Route path="/" element={<h1>בית</h1>} />
        </Routes>,
        "/onboarding",
      );
      expect(screen.getByRole("heading", { name: "בית" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "פרטי העסק" })).not.toBeInTheDocument();
    }],
    ["V22", "empty home hides connect", () => {
      viewer(<HomeScreen />, "/?preview=1");
      expect(screen.getByText("עוד אין נתונים")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "חיבור SUMIT" })).not.toBeInTheDocument();
    }],
    ["V23", "empty projects drop the invitation", () => {
      viewer(<ProjectsScreen sample={{ projects: [] } as unknown as Dashboard} />);
      expect(screen.getByText("פרויקטים מגיעים מ־SUMIT.")).toBeInTheDocument();
      expect(screen.queryByText("ואפשר גם לפתוח אחד כאן")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "פרויקט חדש" })).not.toBeInTheDocument();
    }],
    ["V24", "add is an empty slot", () => {
      viewer(<TabBar allowAdd={false} />);
      const nav = screen.getByRole("navigation", { name: "ניווט ראשי" });
      expect(screen.queryByRole("button", { name: "הוספה" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "הוספה" })).not.toBeInTheDocument();
      expect(nav.querySelectorAll(".ui-tab-slot")).toHaveLength(5);
      expect(nav.querySelector(".ui-fab")).toBeNull();
    }],
    ["V25", "settings carries the quiet line", () => {
      viewer(
        <SettingsScreen
          sample={{
            name: "אלפא",
            connected: false,
            companyId: null,
            lastError: null,
            email: "dana@example.com",
            assistant: { state: "empty" },
            jev: { enabled: false, mode: "shadow", threshold: 0.9, status: "ready" },
          }}
        />,
      );
      const note = screen.getByText(VIEWER_NOTE);
      expect(note).toHaveClass("t-hint");
      const overhead = screen.getByRole("switch", { name: "רווח אחרי כלליות" });
      expect(overhead).toBeDisabled();
      expect(overhead.getAttribute("aria-describedby") ?? "").toContain(note.id);
      const row = overhead.closest("label");
      expect(row).toBeInstanceOf(HTMLElement);
      if (row instanceof HTMLElement) expect(getComputedStyle(row).opacity).toBe("1");
    }],
    ["V26", "review count is plain and the suggestion stays", () => {
      viewer(<ReviewQueue rows={[reviewRow]} search="" sample />);
      expect(screen.getByText(VIEWER_NOTE)).toBeInTheDocument();
      expect(screen.queryByText("מתוך")).not.toBeInTheDocument();
      expect(screen.getAllByText("הצעה").length).toBeGreaterThan(0);
      expect(screen.getByText("פרויקט א")).toBeInTheDocument();
    }],
    ["V27", "a disabled switch stays at full strength", () => {
      viewer(
        <ConnectionsScreen
          sample={{
            name: "אלפא",
            connected: true,
            companyId: 1,
            lastError: null,
            email: "dana@example.com",
            assistant: { state: "empty" },
            jev: { enabled: true, mode: "shadow", threshold: 0.9, status: "ready" },
          }}
        />,
      );
      const jev = screen.getByRole("switch", { name: "תיוג חכם (Jev)" });
      const row = jev.closest("label");
      expect(row).toBeInstanceOf(HTMLElement);
      if (!(row instanceof HTMLElement)) return;
      expect(getComputedStyle(row).opacity).toBe("1");
      expect(getComputedStyle(row).cursor).toBe("not-allowed");
    }],
    ["V29", "an expired assistant is neutral", () => {
      viewer(
        <ConnectionsScreen
          sample={{
            name: "אלפא",
            connected: true,
            companyId: 1,
            lastError: null,
            email: "dana@example.com",
            assistant: { state: "expired" },
            jev: { enabled: false, mode: "shadow", threshold: 0.9, status: "ready" },
          }}
        />,
      );
      expect(screen.getByText("לא מחובר כרגע")).toBeInTheDocument();
      expect(screen.queryByText("צריך לחבר מחדש")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /עוזר AI/ })).not.toBeInTheDocument();
    }],
    ["V30", "a category row drops the pointer", () => {
      viewer(
        <CategoriesScreen
          sample={[{ id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: true, count: 1 }]}
        />,
      );
      const row = screen.getByText("חומרים").closest(".ui-row");
      expect(row).toBeInstanceOf(HTMLElement);
      if (!(row instanceof HTMLElement)) return;
      expect(row.classList.contains("ui-hit")).toBe(false);
      expect(getComputedStyle(row).cursor).not.toBe("pointer");
    }],
    ["V31", "the project menu stays off", () => {
      viewer(
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectDetailScreen sample={project} />} />
        </Routes>,
        "/projects/p1",
      );
      expect(screen.getByRole("heading", { name: "שיפוץ" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "עוד" })).not.toBeInTheDocument();
      expect(document.querySelector(".ui-menu-slot")).toBeInstanceOf(HTMLElement);
    }],
    ["V32", "the project overhead switch is disabled", () => {
      viewer(
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectDetailScreen sample={project} />} />
        </Routes>,
        "/projects/p1",
      );
      expect(screen.getByRole("switch", { name: "אחרי חלק בהוצאות כלליות" })).toBeDisabled();
      expect(screen.queryByText(VIEWER_NOTE)).not.toBeInTheDocument();
    }],
    ["V33", "the project skeleton keeps an empty menu slot", () => {
      const pending = vi.spyOn(supabaseModule, "getSupabase").mockReturnValue({
        rpc: () => new Promise(() => undefined),
      } as never);
      try {
        viewer(
          <Routes>
            <Route path="/projects/:projectId" element={<ProjectDetailScreen />} />
          </Routes>,
          "/projects/p1",
        );
        expect(screen.getAllByText("טוען…").length).toBeGreaterThan(0);
        expect(screen.queryByRole("button", { name: "עוד" })).not.toBeInTheDocument();
        expect(document.querySelector(".ui-menu-slot")).toBeInstanceOf(HTMLElement);
      } finally {
        pending.mockRestore();
      }
    }],
  ] as const)("%s %s", (_id, _title, run) => {
    run();
  });

  it("shows עוד on the project skeleton once the role is owner", () => {
    const pending = vi.spyOn(supabaseModule, "getSupabase").mockReturnValue({
      rpc: () => new Promise(() => undefined),
    } as never);
    try {
      renderScreen(
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectDetailScreen />} />
        </Routes>,
        "/projects/p1",
      );
      expect(screen.getByRole("button", { name: "עוד" })).toBeInTheDocument();
      expect(document.querySelector(".ui-menu-slot")).toBeNull();
    } finally {
      pending.mockRestore();
    }
  });

  it("keeps the pointer on an owner category row", () => {
    renderScreen(
      <CategoriesScreen
        sample={[{ id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: true, count: 1 }]}
      />,
    );
    const row = screen.getByText("חומרים").closest(".ui-row");
    expect(row).toBeInstanceOf(HTMLElement);
    if (!(row instanceof HTMLElement)) return;
    expect(row.classList.contains("ui-hit")).toBe(true);
    expect(getComputedStyle(row).cursor).toBe("pointer");
  });
});
