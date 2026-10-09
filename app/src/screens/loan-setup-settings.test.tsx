import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { contractualPaymentMinor } from "@flow/shared";
import { ToastProvider } from "../ui/toast";
import { ViewerPreview } from "../use-is-viewer";
import { firstOfNextMonth } from "./loan-form";
import { LoanProjectPicker, LoanSettingsSection } from "./loan-setup";

const db = vi.hoisted(() => ({
  inserts: [] as Array<Record<string, unknown>>,
  insertError: null as { message: string; code?: string } | null,
  hold: null as Promise<void> | null,
  baseCurrency: null as string | null,
  currencyError: null as { message: string } | null,
  currencyHold: null as Promise<void> | null,
  offline: false,
  selects: 0,
  balanceError: null as { message: string } | null,
  loans: [] as Array<{ id: string; name: string; currency: string; project_id: string | null }>,
  projects: [] as Array<{ id: string; name: string }>,
  updates: [] as Array<{ row: Record<string, unknown>; id: string }>,
  updateRows: 1,
  updateError: null as { message: string; code?: string } | null,
  updateHold: null as Promise<void> | null,
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => {
    if (db.offline) return null;
    return {
      rpc: (name: string) => {
        if (name !== "mcp_company_loan_currency") throw new Error(name);
        db.selects += 1;
        const finish = () => ({ data: db.currencyError ? null : db.baseCurrency, error: db.currencyError });
        if (db.currencyHold) return db.currencyHold.then(() => finish());
        return Promise.resolve(finish());
      },
      from: (table: string) => {
        if (table === "loans") {
          return {
            insert: (row: Record<string, unknown>) => ({
              select: () => ({
                single: () => {
                  db.inserts.push(row);
                  const finish = () => ({ data: db.insertError ? null : { id: `new-${String(db.inserts.length)}` }, error: db.insertError });
                  if (db.hold) return db.hold.then(() => finish());
                  return Promise.resolve(finish());
                },
              }),
            }),
            select: () => ({
              eq: () => ({
                order: () => Promise.resolve({ data: db.loans.map((loan) => ({ kind: "amortizing", status: "open", closed_on: null, ...loan })), error: null }),
              }),
            }),
            update: (row: Record<string, unknown>) => ({
              eq: (_column: string, id: string) => ({
                select: () => {
                  db.updates.push({ row, id });
                  const finish = () => ({
                    data: db.updateError ? null : Array.from({ length: db.updateRows }, () => ({ id })),
                    error: db.updateError,
                  });
                  if (db.updateHold) return db.updateHold.then(() => finish());
                  return Promise.resolve(finish());
                },
              }),
            }),
          };
        }
        if (table === "projects") {
          return {
            select: () => ({
              in: () => Promise.resolve({ data: db.projects, error: null }),
            }),
          };
        }
        if (table === "loan_balances") {
          return {
            select: () => Promise.resolve({
              data: db.balanceError ? null : db.loans.map((loan) => ({ loan_id: loan.id, balance_minor: 500000, flagged_parts: 0, currency: loan.currency })),
              error: db.balanceError,
            }),
          };
        }
        throw new Error(table);
      },
    };
  },
}));

beforeEach(() => {
  db.inserts = [];
  db.insertError = null;
  db.hold = null;
  db.baseCurrency = "ILS";
  db.currencyError = null;
  db.currencyHold = null;
  db.offline = false;
  db.selects = 0;
  db.balanceError = null;
  db.loans = [];
  db.projects = [];
  db.updates = [];
  db.updateRows = 1;
  db.updateError = null;
  db.updateHold = null;
});

function sectionTree(client: QueryClient, ui: ReactNode) {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function renderSection(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(sectionTree(client, ui));
  return Object.assign(view, { client });
}

function openLoan() {
  fireEvent.click(screen.getByRole("button", { name: "הלוואה חדשה" }));
}

async function expectReopenedBlank(inserts: number) {
  await waitFor(() => {
    expect(screen.queryByRole("heading", { name: "הלוואה" })).not.toBeInTheDocument();
  });
  openLoan();
  expect(screen.getByLabelText("מלווה")).toHaveValue("");
  expect(screen.getByLabelText("סכום מקורי")).toHaveValue("");
  expect(screen.getByLabelText("ריבית שנתית")).toHaveValue("");
  const save = screen.getByRole("button", { name: "שמירה" });
  expect(save).toBeEnabled();
  fireEvent.click(save);
  expect(screen.getByText("כתבו את שם המלווה.")).toBeInTheDocument();
  await act(async () => {
    await new Promise((resolve) => { setTimeout(resolve, 40); });
  });
  expect(db.inserts).toHaveLength(inserts);
}

function fillSavable() {
  fireEvent.change(screen.getByLabelText("מלווה"), { target: { value: "הלוואת דוגמה" } });
  fireEvent.change(screen.getByLabelText("סכום מקורי"), { target: { value: "100000" } });
  fireEvent.change(screen.getByLabelText("ריבית שנתית"), { target: { value: "11.2042" } });
}

describe("LoanSettingsSection", () => {
  it("hides a new loan from a viewer and keeps the balances readable (FLOW-501, U10)", async () => {
    db.loans = [{ id: "l1", name: "משכנתא אלון", currency: "ILS", project_id: null }];
    renderSection(
      <ViewerPreview>
        <LoanSettingsSection companyId="co-1" companyCurrency="ILS" />
      </ViewerPreview>,
    );
    expect(await screen.findByText("משכנתא אלון")).toBeInTheDocument();
    // FLOW-106 B: the row opens the loan's page, which a viewer reads as static rows.
    expect(screen.getByRole("button", { name: /^משכנתא אלון, / })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "הלוואה חדשה" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "הלוואה" })).not.toBeInTheDocument();
  });

  it("opens the new-loan sheet from ?new=loan for an owner only (FLOW-331)", async () => {
    const at = (ui: ReactNode) => (
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <MemoryRouter initialEntries={["/settings/loans?new=loan"]}>{ui}</MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    );
    const owner = render(at(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" />));
    expect(await screen.findByRole("dialog", { name: "הלוואה" })).toBeInTheDocument();
    owner.unmount();
    render(at(
      <ViewerPreview>
        <LoanSettingsSection companyId="co-1" companyCurrency="ILS" />
      </ViewerPreview>,
    ));
    expect(await screen.findByText("כשיתווספו הלוואות הן יופיעו כאן.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "הלוואה" })).not.toBeInTheDocument();
  });

  it("shows the empty state with one primary action, and none for a viewer", async () => {
    const owner = renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" />);
    expect(await screen.findByText("אין הלוואות עדיין")).toBeInTheDocument();
    expect(screen.getByText("הוסיפו הלוואה כדי לפצל כל תשלום לריבית, מסים וביטוח וקרן.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "הלוואה חדשה" })).toHaveLength(1);
    owner.unmount();
    renderSection(
      <ViewerPreview>
        <LoanSettingsSection companyId="co-1" companyCurrency="ILS" />
      </ViewerPreview>,
    );
    expect(await screen.findByText("כשיתווספו הלוואות הן יופיעו כאן.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "הלוואה חדשה" })).not.toBeInTheDocument();
  });

  it("returns focus to the empty state's button when the new-loan sheet closes", async () => {
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" />);
    await screen.findByText("אין הלוואות עדיין");
    const add = screen.getByRole("button", { name: "הלוואה חדשה" });
    fireEvent.click(add);
    fireEvent.click(within(screen.getByRole("dialog", { name: "הלוואה" })).getByRole("button", { name: "סגירה" }));
    await waitFor(() => { expect(add).toHaveFocus(); }, { timeout: 2500 });
  });

  it("opens the sheet on the company currency", () => {
    renderSection(<LoanSettingsSection companyId={null} companyCurrency="USD" />);
    openLoan();
    expect(screen.getByRole("heading", { name: "הלוואה" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "$" })).toBeChecked();
  });

  it("shows a retry when the balances read fails", async () => {
    db.balanceError = { message: "offline" };
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" />);
    expect(await screen.findByText("לא הצלחנו לטעון את ההלוואות")).toBeInTheDocument();
    // An error is not an empty state with a live primary action (CHECKLIST).
    expect(screen.queryByRole("button", { name: "הלוואה חדשה" })).not.toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "ניסיון חוזר" });
    db.balanceError = null;
    fireEvent.click(retry);
    await waitFor(() => { expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).not.toBeInTheDocument(); });
    expect(screen.getByText("אין הלוואות עדיין")).toBeInTheDocument();
  });

  it("inserts the allowed columns, in minor units, with the typed rate", async () => {
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" />);
    openLoan();
    fillSavable();
    expect(screen.getByLabelText("ריבית שנתית")).toHaveValue("11.2042");
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(db.inserts).toHaveLength(1); });
    const payment = contractualPaymentMinor({
      principalMinor: 10_000_000n,
      annualRatePpm: 112_042,
      termMonths: 360,
    });
    expect(db.inserts[0]).toEqual({
      company_id: "co-1",
      name: "הלוואת דוגמה",
      principal_minor: 10_000_000,
      annual_rate_ppm: 112_042,
      term_months: 360,
      start_date: firstOfNextMonth(),
      payment_minor: Number(payment),
      escrow_minor: 0,
      currency: "ILS",
      project_id: null,
    });
  });

  it("posts once when save is submitted twice", async () => {
    let release: () => void = () => undefined;
    db.hold = new Promise((resolve) => { release = resolve; });
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" />);
    openLoan();
    fillSavable();
    const save = screen.getByRole("button", { name: "שמירה" });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => { expect(db.inserts).toHaveLength(1); });
    release();
    await waitFor(() => { expect(screen.getByRole("status")).toHaveTextContent("ההלוואה נשמרה"); });
  });

  it("keeps the sheet open and names a permission failure", async () => {
    db.insertError = { message: "denied", code: "42501" };
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" />);
    openLoan();
    fillSavable();
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => {
      expect(screen.getByRole("status", { hidden: true })).toHaveTextContent("אין הרשאה לשמור הלוואה.");
    });
    expect(screen.getByRole("heading", { name: "הלוואה" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "שמירה" })).toHaveFocus();
  });

  it("keeps the sheet open on a generic failure and returns focus to save", async () => {
    let release: () => void = () => undefined;
    db.hold = new Promise((resolve) => { release = resolve; });
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" />);
    openLoan();
    fillSavable();
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(screen.getByLabelText("סכום מקורי")).toBeDisabled(); });
    expect(screen.getByRole("button", { name: "שמירה" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("radio", { name: "₪" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "תאריך תשלום ראשון" })).toBeDisabled();
    expect(screen.getByLabelText("מלווה")).toBeDisabled();
    db.insertError = { message: "down" };
    release();
    await waitFor(() => {
      expect(screen.getByRole("status", { hidden: true })).toHaveTextContent("לא הצלחנו לשמור את ההלוואה.");
    });
    expect(screen.getByRole("heading", { name: "הלוואה" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "שמירה" })).toHaveFocus();
    expect(screen.getByLabelText("סכום מקורי")).toBeEnabled();
  });

  it("keeps the sheet on ✕ and Escape while a save runs (FLOW-115)", async () => {
    let release: () => void = () => undefined;
    db.hold = new Promise((resolve) => { release = resolve; });
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" />);
    openLoan();
    fillSavable();
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(screen.getByLabelText("סכום מקורי")).toBeDisabled(); });
    fireEvent.click(within(screen.getByRole("dialog", { name: "הלוואה" })).getByRole("button", { name: "סגירה" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("heading", { name: "הלוואה" })).toBeInTheDocument();
    release();
    await waitFor(() => { expect(screen.getByRole("status")).toHaveTextContent("ההלוואה נשמרה"); });
  });

  it("toasts and closes after a save", async () => {
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" />);
    openLoan();
    fillSavable();
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(screen.getByRole("status")).toHaveTextContent("ההלוואה נשמרה"); });
    await expectReopenedBlank(1);
  });

  it("discards the draft when the sheet is closed", async () => {
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" />);
    openLoan();
    fillSavable();
    fireEvent.click(within(screen.getByRole("dialog", { name: "הלוואה" })).getByRole("button", { name: "סגירה" }));
    await expectReopenedBlank(0);
  });

  it("discards the draft on Escape", async () => {
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" />);
    openLoan();
    fillSavable();
    fireEvent.keyDown(document, { key: "Escape" });
    await expectReopenedBlank(0);
  });

  it("discards the draft on Back", async () => {
    const router = createMemoryRouter(
      [{ path: "/settings", element: <LoanSettingsSection companyId="co-1" companyCurrency="ILS" /> }],
      { initialEntries: ["/settings"] },
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>,
    );
    openLoan();
    await waitFor(() => {
      expect(router.state.location.state).toMatchObject({ flowLayer: "loan-new" });
    });
    fillSavable();
    await act(async () => {
      await router.navigate(-1);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expectReopenedBlank(0);
  });

  it("does not insert when preview mode blocks the save", async () => {
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" blocked={() => true} />);
    openLoan();
    fillSavable();
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await act(async () => {
      await new Promise((resolve) => { setTimeout(resolve, 40); });
    });
    expect(db.inserts).toHaveLength(0);
    expect(screen.getByRole("heading", { name: "הלוואה" })).toBeInTheDocument();
    expect(screen.queryByText("ההלוואה נשמרה")).not.toBeInTheDocument();
  });

  it("keeps typed input when the form remounts", async () => {
    let release: () => void = () => undefined;
    db.currencyHold = new Promise((resolve) => { release = resolve; });
    db.baseCurrency = "USD";
    const view = renderSection(<LoanSettingsSection companyId={null} companyCurrency="ILS" />);
    openLoan();
    fireEvent.change(screen.getByLabelText("מלווה"), { target: { value: "בנק דוגמה" } });
    fireEvent.change(screen.getByLabelText("סכום מקורי"), { target: { value: "1500" } });
    view.rerender(sectionTree(view.client, <LoanSettingsSection companyId="co-1" />));
    expect(screen.getByRole("status")).toHaveTextContent("טוען…");
    expect(screen.queryByLabelText("מלווה")).not.toBeInTheDocument();
    release();
    expect(await screen.findByLabelText("מלווה")).toHaveValue("בנק דוגמה");
    expect(screen.getByLabelText("סכום מקורי")).toHaveValue("1,500");
  });
});

describe("FLOW-119 loan project", () => {
  const projects = {
    rows: [
      { id: "p-a", name: "פרויקט א", status: "active" as const },
      { id: "p-b", name: "פרויקט ב", status: "active" as const },
      { id: "p-old", name: "פרויקט ישן", status: "finished" as const },
    ],
  };

  it("files a new loan under the picked project and back returns to the form", async () => {
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" projects={projects} />);
    openLoan();
    fillSavable();
    const field = screen.getByRole("button", { name: "פרויקט ללא פרויקט" });
    fireEvent.click(field);
    expect(screen.getByRole("heading", { name: "פרויקט" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "פרויקט ישן" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "חזרה" }));
    expect(screen.getByRole("heading", { name: "הלוואה" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "פרויקט ללא פרויקט" }));
    fireEvent.click(screen.getByRole("radio", { name: "פרויקט א" }));
    expect(screen.getByRole("heading", { name: "הלוואה" })).toBeInTheDocument();
    expect(screen.getByLabelText("מלווה")).toHaveValue("הלוואת דוגמה");
    expect(screen.getByRole("button", { name: "פרויקט פרויקט א" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(db.inserts).toHaveLength(1); });
    expect(db.inserts[0]?.project_id).toBe("p-a");
  });

  it("keeps the form's height while the picker is shown", async () => {
    const spy = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(480);
    onTestFinished(() => { spy.mockRestore(); });
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" projects={projects} />);
    openLoan();
    fireEvent.click(screen.getByRole("button", { name: "פרויקט ללא פרויקט" }));
    const group = await screen.findByRole("radiogroup", { name: "פרויקט" });
    expect(group.closest<HTMLElement>("[style]")?.style.minHeight).toBe("480px");
  });

  it("shows project codes and finds a project by its code", () => {
    const many = {
      rows: Array.from({ length: 10 }, (_, index) => ({
        id: `p-${String(index)}`,
        name: `פרויקט ${String(index + 1)}`,
        status: "active" as const,
        code: `P-${String(index + 1)}`,
      })),
    };
    render(<LoanProjectPicker source={many} selectedId={null} onSelect={() => undefined} />);
    const search = screen.getByRole("searchbox", { name: "חיפוש פרויקט" });
    expect(search).toHaveAttribute("placeholder", "חיפוש פרויקט או קוד");
    expect(screen.getByText("P-3")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "p-10" } });
    expect(screen.getAllByRole("radio").map((node) => node.getAttribute("aria-label") ?? node.textContent)).toHaveLength(2);
    expect(screen.getByRole("radio", { name: /פרויקט 10/ })).toBeInTheDocument();
  });

  it("keeps the plain placeholder when no project has a code", () => {
    const many = { rows: Array.from({ length: 10 }, (_, index) => ({ id: `p-${String(index)}`, name: `פרויקט ${String(index + 1)}` })) };
    render(<LoanProjectPicker source={many} selectedId={null} onSelect={() => undefined} />);
    expect(screen.getByRole("searchbox", { name: "חיפוש פרויקט" })).toHaveAttribute("placeholder", "חיפוש פרויקט");
  });

  it("keeps ללא פרויקט when the projects fail to load", () => {
    renderSection(
      <LoanSettingsSection companyId="co-1" companyCurrency="ILS" projects={{ rows: [], error: true }} />,
    );
    openLoan();
    fireEvent.click(screen.getByRole("button", { name: "פרויקט ללא פרויקט" }));
    expect(screen.getByRole("radio", { name: "ללא פרויקט" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ניסיון חוזר: פרויקטים" })).toBeInTheDocument();
  });

  it("moves focus to the picker title, and back to the field on חזרה", async () => {
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" projects={projects} />);
    openLoan();
    const field = screen.getByRole("button", { name: "פרויקט ללא פרויקט" });
    field.focus();
    fireEvent.click(field);
    await waitFor(() => { expect(screen.getByRole("heading", { name: "פרויקט" })).toHaveFocus(); });
    expect(field).not.toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "חזרה" }));
    await waitFor(() => { expect(screen.getByRole("button", { name: "פרויקט ללא פרויקט" })).toHaveFocus(); });
  });

  it("goes back to the form on Back in the new-loan picker and keeps the draft", async () => {
    const router = createMemoryRouter(
      [{ path: "/settings", element: <LoanSettingsSection companyId="co-1" companyCurrency="ILS" projects={projects} /> }],
      { initialEntries: ["/settings"] },
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "הלוואה חדשה" }));
    await waitFor(() => {
      expect(router.state.location.state).toMatchObject({ flowLayer: "loan-new" });
    });
    fillSavable();
    fireEvent.click(screen.getByRole("button", { name: "פרויקט ללא פרויקט" }));
    expect(screen.getByRole("heading", { name: "פרויקט" })).toBeInTheDocument();
    await act(async () => {
      await router.navigate(-1);
      window.dispatchEvent(new PopStateEvent("popstate"));
      await new Promise((resolve) => { setTimeout(resolve, 50); });
    });
    expect(screen.getByRole("heading", { name: "הלוואה" })).toBeInTheDocument();
    expect(screen.getByLabelText("מלווה")).toHaveValue("הלוואת דוגמה");
  });

  it("opens a loan's page from its row (FLOW-106 B)", async () => {
    db.loans = [{ id: "l-1", name: "הלוואת דוגמה", currency: "ILS", project_id: "p-a" }];
    db.projects = [{ id: "p-a", name: "פרויקט א" }];
    const router = createMemoryRouter(
      [
        { path: "/settings/loans", element: <LoanSettingsSection companyId="co-1" companyCurrency="ILS" projects={projects} /> },
        { path: "/settings/loans/:loanId", element: <p>עמוד ההלוואה</p> },
      ],
      { initialEntries: ["/settings/loans"] },
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /^הלוואת דוגמה, .*פרויקט א$/ }));
    await waitFor(() => { expect(router.state.location.pathname).toBe("/settings/loans/l-1"); });
  });

  it("refetches loans and the project screen after a new loan", async () => {
    const view = renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" projects={projects} />);
    const invalidate = vi.spyOn(view.client, "invalidateQueries");
    openLoan();
    fillSavable();
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(db.inserts).toHaveLength(1); });
    await waitFor(() => { expect(invalidate).toHaveBeenCalledWith({ queryKey: ["project"] }); });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["loans"] });
  });

  it("resets the project to ללא פרויקט when the project is gone on save", async () => {
    db.insertError = { message: "fk", code: "23503" };
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" projects={projects} />);
    openLoan();
    fillSavable();
    fireEvent.click(screen.getByRole("button", { name: "פרויקט ללא פרויקט" }));
    fireEvent.click(screen.getByRole("radio", { name: "פרויקט א" }));
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => {
      expect(screen.getByRole("status", { hidden: true })).toHaveTextContent("הפרויקט לא נמצא.");
    });
    expect(screen.getByRole("heading", { name: "הלוואה" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "פרויקט ללא פרויקט" })).toBeInTheDocument();
  });

  it("reopens on the form with ללא פרויקט after closing from the picker", async () => {
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" projects={projects} />);
    openLoan();
    fireEvent.click(screen.getByRole("button", { name: "פרויקט ללא פרויקט" }));
    fireEvent.click(screen.getByRole("radio", { name: "פרויקט א" }));
    fireEvent.click(screen.getByRole("button", { name: "פרויקט פרויקט א" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "פרויקט" })).getByRole("button", { name: "סגירה" }));
    await waitFor(() => { expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); });
    openLoan();
    expect(screen.getByRole("heading", { name: "הלוואה" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "פרויקט ללא פרויקט" })).toBeInTheDocument();
  });

  it("returns to the form on Escape in the picker and keeps the draft", async () => {
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" projects={projects} />);
    openLoan();
    fillSavable();
    fireEvent.click(screen.getByRole("button", { name: "פרויקט ללא פרויקט" }));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => { expect(screen.getByRole("heading", { name: "הלוואה" })).toBeInTheDocument(); });
    expect(screen.getByLabelText("מלווה")).toHaveValue("הלוואת דוגמה");
  });

  it("searches above eight projects and keeps ללא פרויקט", () => {
    const many = { rows: Array.from({ length: 9 }, (_, index) => ({ id: `m${String(index)}`, name: `פרויקט ${String(index + 1)}`, status: "active" as const })) };
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" projects={many} />);
    openLoan();
    fireEvent.click(screen.getByRole("button", { name: "פרויקט ללא פרויקט" }));
    const search = screen.getByRole("searchbox", { name: "חיפוש פרויקט" });
    fireEvent.change(search, { target: { value: "9" } });
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByRole("radio", { name: "פרויקט 9" })).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "אין כזה" } });
    expect(screen.getByText("לא נמצא פרויקט בשם הזה")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "ללא פרויקט" })).toBeInTheDocument();
  });

  it("has no search with eight projects", () => {
    const eight = { rows: Array.from({ length: 8 }, (_, index) => ({ id: `m${String(index)}`, name: `פרויקט ${String(index + 1)}`, status: "active" as const })) };
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" projects={eight} />);
    openLoan();
    fireEvent.click(screen.getByRole("button", { name: "פרויקט ללא פרויקט" }));
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });
});
