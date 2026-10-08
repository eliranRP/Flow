import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TransactionDetail } from "@flow/shared";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  SAMPLE_EXPENSE_LINE,
  SAMPLE_REFUND_LINE,
  SAMPLE_SPLIT_CATEGORIES,
  SAMPLE_SPLIT_PROJECTS,
  sampleSplitApi,
} from "../dev/line-split-sample";
import type { LineSplitRead, PartDraft, PayloadPart } from "../line-split";
import { BooksProvider } from "../use-books";
import { ViewerPreview } from "../use-is-viewer";
import { ToastProvider } from "../ui/toast";
import { SplitScreen, TransactionScreen } from "./flow-screens";
import { LineSplitScreen, type LineInfo, type LineSplitApi, type LineSplitSample } from "./line-split";

function showEditor(sample: Partial<LineSplitSample> & { line?: LineInfo } = {}) {
  const line = sample.line ?? SAMPLE_EXPENSE_LINE;
  const full: LineSplitSample = {
    line,
    categories: SAMPLE_SPLIT_CATEGORIES,
    projects: SAMPLE_SPLIT_PROJECTS,
    api: sampleSplitApi(line),
    ...sample,
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <BooksProvider>
          <MemoryRouter initialEntries={[`/transactions/${line.id}/split-category`]}>
            <Routes>
              <Route path="/transactions/:transactionId/split-category" element={<LineSplitScreen sample={full} />} />
              <Route path="/transactions/:transactionId" element={<p>פרטי התנועה</p>} />
            </Routes>
          </MemoryRouter>
        </BooksProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** An api whose save records each request and can be told to fail. */
function recordingApi(line: LineInfo, fail?: Error) {
  const saved: PayloadPart[][] = [];
  const base = sampleSplitApi(line);
  const api: LineSplitApi = {
    preview: base.preview,
    save: async (parts) => {
      saved.push(parts);
      if (fail) throw fail;
      await base.save(parts);
    },
  };
  return { api, saved };
}

const expenseParts: PartDraft[] = [
  { key: "a", categoryId: "c-elec", projectId: "p-herz", unit: "percent", value: "30" },
  { key: "b", categoryId: "c-ins", projectId: "p-raan", unit: "amount", value: "500" },
];

function restRow() {
  return screen.getByRole("button", { name: /^השאר,/ });
}

describe("split by category editor (FLOW-325)", () => {
  it("adds a part through the picker, flips its unit, and the rest follows the server preview", async () => {
    showEditor();
    expect(screen.getByRole("heading", { name: "פיצול לפי קטגוריות" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "הוספת חלק" }));
    const categorySheet = await screen.findByRole("dialog", { name: "בחירת קטגוריה" });
    fireEvent.click(within(categorySheet).getByRole("radio", { name: "חשמל" }));
    // The category pick moves straight on to the project list.
    const projectSheet = await screen.findByRole("dialog", { name: "בחירת פרויקט" });
    expect(within(projectSheet).getByRole("radio", { name: "פרויקט גבעתיים · פרויקט השורה" })).toBeInTheDocument();
    fireEvent.click(within(projectSheet).getByRole("radio", { name: "פרויקט הרצליה" }));
    await waitFor(() => { expect(screen.queryByRole("dialog")).toBeNull(); });
    fireEvent.change(screen.getByLabelText("סכום, חשמל"), { target: { value: "500" } });
    await waitFor(() => { expect(restRow()).toHaveTextContent("₪4,300"); });
    expect(screen.getByText("10.42%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "%" }));
    expect(screen.getByLabelText("אחוז, חשמל")).toHaveValue("10.42");
    await waitFor(() => { expect(restRow()).toHaveTextContent("₪4,299.84"); });
  });

  it("saves on ✕ with each part's percent, amount and the rest, then toasts with ביטול", async () => {
    const { api, saved } = recordingApi(SAMPLE_EXPENSE_LINE);
    showEditor({ parts: expenseParts, api });
    await waitFor(() => { expect(restRow()).toHaveTextContent("₪2,860"); });
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(await screen.findByText("החלוקה נשמרה")).toBeInTheDocument();
    expect(saved).toEqual([[
      { category_id: "c-elec", project_id: "p-herz", percent: 30 },
      { category_id: "c-ins", project_id: "p-raan", amount_minor: 50_000 },
      { rest: true },
    ]]);
    expect(await screen.findByText("פרטי התנועה")).toBeInTheDocument();
    // ביטול puts back what was there before: nothing, so the split is cleared.
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    expect(await screen.findByText("החלוקה הקודמת חזרה")).toBeInTheDocument();
    expect(saved[1]).toEqual([]);
  });

  it("a reversal part with no project holds the first ✕, and the second discards", async () => {
    const { api, saved } = recordingApi(SAMPLE_REFUND_LINE);
    showEditor({
      line: SAMPLE_REFUND_LINE,
      api,
      parts: [{ key: "a", categoryId: "c-build", projectId: null, unit: "percent", value: "40" }],
    });
    const pick = screen.getByRole("button", { name: /^חומרי בניין, החזר, פרויקט · חובה בהחזר/ });
    expect(pick).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(await screen.findByText("בחרו פרויקט לחלק ההחזר.")).toBeInTheDocument();
    expect(screen.getByText("חלק החזר צריך פרויקט.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ביטול השינוי" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(await screen.findByText("פרטי התנועה")).toBeInTheDocument();
    expect(saved).toEqual([]);
  });

  it("the refund's category picker offers expense categories as reversals, and a reversal asks for a project", async () => {
    showEditor({ line: SAMPLE_REFUND_LINE });
    fireEvent.click(screen.getByRole("button", { name: "הוספת חלק" }));
    const sheet = await screen.findByRole("dialog", { name: "בחירת קטגוריה" });
    fireEvent.click(within(sheet).getByRole("button", { name: "הוצאה שהוחזרה" }));
    fireEvent.click(within(sheet).getByRole("radio", { name: "קבלני משנה" }));
    const projects = await screen.findByRole("dialog", { name: "בחירת פרויקט" });
    expect(within(projects).getByText("חלק החזר צריך פרויקט.")).toBeInTheDocument();
    expect(within(projects).queryByRole("radio", { name: /פרויקט השורה/ })).toBeNull();
  });

  it("shows the over amount in the footer and on the part edited last", () => {
    showEditor({
      parts: [
        { key: "a", categoryId: "c-elec", projectId: "p-herz", unit: "percent", value: "70" },
        { key: "b", categoryId: "c-ins", projectId: "p-raan", unit: "amount", value: "2000" },
      ],
    });
    expect(screen.getByText("עוברים את השורה")).toBeInTheDocument();
    // One sentence, under the part edited last and on the hold line.
    expect(screen.getAllByText("החלקים עוברים את השורה ב־₪560. הקטינו חלק.")).toHaveLength(2);
    expect(screen.queryByText(/גבוהים מהשורה/)).toBeNull();
    expect(restRow()).toHaveTextContent("לא נשאר");
  });

  it("maps a server refusal to a banner and keeps the screen open", async () => {
    const { api } = recordingApi(SAMPLE_EXPENSE_LINE, new Error("line has an open review"));
    showEditor({ parts: expenseParts, api });
    await waitFor(() => { expect(restRow()).toHaveTextContent("₪2,860"); });
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(await screen.findByText("אשרו את התנועה בתור לאישור, ואז פצלו.")).toBeInTheDocument();
    expect(screen.queryByText("פרטי התנועה")).toBeNull();
  });

  it("a dropped connection toasts ניסיון חוזר and keeps the values", async () => {
    const { api, saved } = recordingApi(SAMPLE_EXPENSE_LINE, new Error("Failed to fetch"));
    showEditor({ parts: expenseParts, api });
    await waitFor(() => { expect(restRow()).toHaveTextContent("₪2,860"); });
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(await screen.findByText("החלוקה לא נשמרה")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ניסיון חוזר" })).toBeInTheDocument();
    expect(screen.getByLabelText("אחוז, חשמל")).toHaveValue("30");
    fireEvent.click(screen.getByRole("button", { name: "ניסיון חוזר" }));
    await waitFor(() => { expect(saved).toHaveLength(2); });
  });

  it("a server reason from the preview shows before the save", async () => {
    showEditor({
      parts: [{ key: "a", categoryId: "c-elec", projectId: "p-herz", unit: "amount", value: "4800" }],
      warned: true,
    });
    expect(await screen.findAllByText("לא נשאר סכום לשאר. הוסיפו חלק או הקטינו את החלק.")).not.toHaveLength(0);
  });

  it("clearing asks first, then ביטול re-sends the saved parts as amounts", async () => {
    const split: LineSplitRead = {
      transactionId: SAMPLE_EXPENSE_LINE.id,
      currency: "ILS",
      lineMinor: 480_000n,
      partsMatch: true,
      parts: [
        { category_id: "c-elec", category_name: "חשמל", project_id: "p-herz", project_name: "פרויקט הרצליה", amount_minor: 144_000n, percent: 30, rest: false },
        { category_id: "c-build", category_name: "חומרי בניין", project_id: null, project_name: null, amount_minor: 336_000n, percent: null, rest: true },
      ],
    };
    const { api, saved } = recordingApi(SAMPLE_EXPENSE_LINE);
    showEditor({ split, api });
    expect(screen.getByLabelText("אחוז, חשמל")).toHaveValue("30");
    fireEvent.click(screen.getByRole("button", { name: "הסרת הפיצול" }));
    // Full runs load the machine, so each wait gets more than the 1s default (FLOW-325 flake).
    const confirm = await screen.findByRole("dialog", { name: "להסיר את הפיצול?" }, { timeout: 5000 });
    expect(within(confirm).getByText("השורה תיספר שוב כולה תחת חומרי בניין · פרויקט גבעתיים.")).toBeInTheDocument();
    expect(saved).toEqual([]);
    fireEvent.click(within(confirm).getByRole("button", { name: "הסרה" }));
    expect(await screen.findByText("הפיצול הוסר", undefined, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => { expect(saved[0]).toEqual([]); }, { timeout: 5000 });
    fireEvent.click(await screen.findByRole("button", { name: "ביטול" }, { timeout: 5000 }));
    await waitFor(() => {
      expect(saved[1]).toEqual([
        { category_id: "c-elec", project_id: "p-herz", amount_minor: 144_000 },
        { category_id: "c-build", project_id: null, amount_minor: 336_000 },
      ]);
    }, { timeout: 5000 });
  }, 20_000);

  it("a split_mismatch line saves its parts again on ✕ with no edit, and offers no ביטול", async () => {
    const mismatch: LineSplitRead = {
      transactionId: SAMPLE_EXPENSE_LINE.id,
      currency: "ILS",
      lineMinor: 500_000n,
      partsMatch: false,
      parts: [
        { category_id: "c-elec", category_name: "חשמל", project_id: "p-herz", project_name: "פרויקט הרצליה", amount_minor: 144_000n, percent: 30, rest: false },
        { category_id: "c-build", category_name: "חומרי בניין", project_id: null, project_name: null, amount_minor: 336_000n, percent: null, rest: true },
      ],
    };
    const line = { ...SAMPLE_EXPENSE_LINE, amountNet: -500_000n };
    const { api, saved } = recordingApi(line);
    showEditor({ line, split: mismatch, api });
    await waitFor(() => { expect(restRow()).toHaveTextContent("₪3,500"); });
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(await screen.findByText("החלוקה נשמרה")).toBeInTheDocument();
    expect(saved).toEqual([[{ category_id: "c-elec", project_id: "p-herz", percent: 30 }, { rest: true }]]);
    // The parts before did not sum to the line, so they cannot be put back.
    expect(screen.queryByRole("button", { name: "ביטול" })).toBeNull();
  });

  it("switching % to ₪ before any preview keeps the money: the line × percent", () => {
    showEditor({ parts: [{ key: "a", categoryId: "c-elec", projectId: "p-herz", unit: "percent", value: "30" }] });
    // No preview has come back yet (it waits 250ms).
    fireEvent.click(screen.getByRole("radio", { name: "₪" }));
    expect(screen.getByLabelText("סכום, חשמל")).toHaveValue("1,440");
  });

  it("a part's message describes its field and its pick button", () => {
    showEditor({
      parts: [
        { key: "a", categoryId: "c-elec", projectId: "p-herz", unit: "amount", value: "100" },
        { key: "b", categoryId: "c-elec", projectId: "p-herz", unit: "amount", value: "200" },
      ],
    });
    const field = screen.getAllByLabelText("סכום, חשמל")[0];
    const id = field?.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(id)).toHaveTextContent("הקטגוריה והפרויקט האלה כבר בחלק אחר.");
    expect(screen.getAllByRole("button", { name: /^חשמל, פרויקט הרצליה, שינוי/ })[0]).toHaveAttribute("aria-describedby", id);
  });

  it("the rest row's message sits outside its button and describes it", () => {
    showEditor({ line: { ...SAMPLE_EXPENSE_LINE, categoryId: null, categoryName: null }, parts: expenseParts });
    const row = restRow();
    const id = row.getAttribute("aria-describedby") ?? "";
    const message = document.getElementById(id);
    expect(message).toHaveAttribute("role", "status");
    expect(row).not.toContainElement(message);
    expect(message).toHaveTextContent("לשורה אין קטגוריה. בחרו קטגוריה לשאר.");
  });

  it("the picker gives focus back to the part that opened it", async () => {
    showEditor({ parts: expenseParts });
    const pick = screen.getByRole("button", { name: /^ביטוח, פרויקט רעננה, שינוי/ });
    pick.focus();
    fireEvent.click(pick);
    const sheet = await screen.findByRole("dialog", { name: "בחירת קטגוריה" });
    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => { expect(screen.queryByRole("dialog")).toBeNull(); });
    await waitFor(() => { expect(pick).toHaveFocus(); });
  });

  it("הסרת הפיצול stays open on a line the server will not split, and clearing offers no ביטול", async () => {
    const split: LineSplitRead = {
      transactionId: SAMPLE_EXPENSE_LINE.id,
      currency: "ILS",
      lineMinor: 480_000n,
      partsMatch: true,
      parts: [
        { category_id: "c-elec", category_name: "חשמל", project_id: "p-herz", project_name: "פרויקט הרצליה", amount_minor: 144_000n, percent: null, rest: false },
        { category_id: "c-build", category_name: "חומרי בניין", project_id: null, project_name: null, amount_minor: 336_000n, percent: null, rest: true },
      ],
    };
    const line = { ...SAMPLE_EXPENSE_LINE, loanSplit: true };
    const { api, saved } = recordingApi(line);
    showEditor({ line, split, api });
    expect(screen.getByLabelText("סכום, חשמל")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "הסרת הפיצול" }));
    const confirm = await screen.findByRole("dialog", { name: "להסיר את הפיצול?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "הסרה" }));
    expect(await screen.findByText("הפיצול הוסר")).toBeInTheDocument();
    expect(saved).toEqual([[]]);
    expect(screen.queryByRole("button", { name: "ביטול" })).toBeNull();
  });

  it("an unchanged editor closes with no write", async () => {
    const save = vi.fn();
    showEditor({ api: { preview: () => Promise.resolve([]), save } });
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(await screen.findByText("פרטי התנועה")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it("the saving state disables every field and ✕", () => {
    showEditor({ parts: expenseParts, saving: true });
    expect(screen.getByRole("button", { name: "סגירה" })).toBeDisabled();
    expect(screen.getByLabelText("אחוז, חשמל")).toBeDisabled();
  });
});

const detailLine: NonNullable<TransactionDetail> = {
  id: "t-detail",
  description: "חומרי בניין אלון",
  direction: "expense",
  doc_date: "2026-10-06",
  amount_gross: -480_000n,
  amount_net: -480_000n,
  vat_amount: 0n,
  vat_status: "unknown",
  source: "mercury",
  pnl_role: "project",
  project_id: "p-givat",
  project_name: "פרויקט גבעתיים",
  category_id: "c-build",
  category_name: "חומרי בניין",
  supplier_name: "חומרי בניין אלון",
  customer_name: null,
  review_status: null,
};

const savedSplit: LineSplitRead = {
  transactionId: "t-detail",
  currency: "ILS",
  lineMinor: 480_000n,
  partsMatch: true,
  parts: [
    { category_id: "c-elec", category_name: "חשמל", project_id: "p-herz", project_name: "פרויקט הרצליה", amount_minor: 144_000n, percent: 30, rest: false },
    { category_id: "c-build", category_name: "חומרי בניין", project_id: null, project_name: null, amount_minor: 336_000n, percent: null, rest: true },
  ],
};

function showDetail(sample: NonNullable<TransactionDetail>, split: LineSplitRead | null, viewer = false) {
  const screenNode = <TransactionScreen sample={sample} sampleCategories={SAMPLE_SPLIT_CATEGORIES} sampleLineSplit={split} />;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <BooksProvider>
          <MemoryRouter>{viewer ? <ViewerPreview>{screenNode}</ViewerPreview> : screenNode}</MemoryRouter>
        </BooksProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("the פיצול section on the transaction detail (FLOW-325)", () => {
  it("offers both kinds of split under one heading", () => {
    showDetail(detailLine, null);
    expect(screen.getByRole("heading", { name: "פיצול" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "פיצול בין פרויקטים" })).toHaveAttribute("href", "/transactions/t-detail/split");
    expect(screen.getByRole("link", { name: "פיצול לפי קטגוריות" })).toHaveAttribute("href", "/transactions/t-detail/split-category");
  });

  it("shows a saved split's parts with a סה״כ row, and the category and project rows say the line is split", () => {
    showDetail(detailLine, savedSplit);
    expect(screen.getByRole("link", { name: /^חשמל, פרויקט הרצליה, ₪1,440, עריכת הפיצול/ })).toBeInTheDocument();
    expect(screen.getByText("השאר · חומרי בניין")).toBeInTheDocument();
    expect(screen.getByText("סה״כ")).toBeInTheDocument();
    expect(screen.getAllByText("מפוצל · 2 חלקים · לא נספר כאן")).toHaveLength(2);
    expect(screen.queryByRole("link", { name: "פיצול לפי קטגוריות" })).toBeNull();
  });

  it("a viewer reads the parts as static rows, with no entry rows", () => {
    showDetail(detailLine, savedSplit, true);
    expect(screen.getByText("חשמל")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /עריכת הפיצול/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "פיצול בין פרויקטים" })).toBeNull();
  });

  it("an open review keeps the row visible but off, with the reason", () => {
    showDetail({ ...detailLine, review_status: "open", review_reason: "missing_project" }, null);
    const row = screen.getByRole("button", { name: "פיצול לפי קטגוריות" });
    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("אשרו את התנועה בתור לאישור, ואז פצלו.")).toBeInTheDocument();
  });

  it("a line split by category keeps בין פרויקטים visible but off, with the reason", () => {
    showDetail(detailLine, savedSplit);
    const row = screen.getByRole("button", { name: "פיצול בין פרויקטים" });
    expect(row).toHaveAttribute("aria-disabled", "true");
    const hint = screen.getByText("לשורה יש פיצול לפי קטגוריות. אפשר רק אחד מהשניים.");
    expect(row.getAttribute("aria-describedby")).toBe(hint.id);
    expect(screen.queryByRole("link", { name: "פיצול בין פרויקטים" })).toBeNull();
  });

  it("a split_mismatch review does not block the editor", () => {
    showDetail({ ...detailLine, review_status: "open", review_reason: "split_mismatch" }, null);
    expect(screen.getByRole("link", { name: "פיצול לפי קטגוריות" })).toBeInTheDocument();
  });

  it("a line of zero has no entry for a split by category", () => {
    showDetail({ ...detailLine, amount_net: 0n, amount_gross: 0n }, null);
    expect(screen.queryByRole("link", { name: "פיצול לפי קטגוריות" })).toBeNull();
    expect(screen.getByRole("link", { name: "פיצול בין פרויקטים" })).toBeInTheDocument();
  });
});

describe("the project split on a line split by category (FLOW-325)", () => {
  it("says why instead of offering ניסיון חוזר", async () => {
    const onSave = vi.fn(() => Promise.reject(new Error("line has a split by category")));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter initialEntries={["/split"]}>
              <Routes>
                <Route
                  path="/split"
                  element={
                    <SplitScreen
                      sampleAmount={100_000n}
                      sampleProjects={[
                        { id: "p1", name: "פרויקט הרצליה", incomeAgorot: 1n },
                        { id: "p2", name: "פרויקט רעננה", incomeAgorot: 1n },
                      ]}
                      backTo="/back"
                      onSave={onSave}
                    />
                  }
                />
                <Route path="/back" element={<h1>חזרה</h1>} />
              </Routes>
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("radio", { name: "שווה בין כל הפרויקטים" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
      await Promise.resolve();
    });
    expect(await screen.findByText("לשורה יש פיצול לפי קטגוריות. אפשר רק אחד מהשניים.")).toBeInTheDocument();
    expect(screen.queryByText("החלוקה לא נשמרה")).toBeNull();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).toBeNull();
  });
});
