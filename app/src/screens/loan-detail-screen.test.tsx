// vitest-css: these queries rely on the app's CSS hiding elements.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { oneLoanStore, sampleLoanStore } from "../dev/loan-detail-sample";
import { renderWithProviders } from "../test-render";
import { ViewerPreview } from "../use-is-viewer";
import { LoanDetailScreen } from "./loan-detail-screen";
import type { MemoryLoanStore } from "./loan-detail-store";

// FLOW-106 B. The loan page on a memory store: the project sheet (moved here from the list,
// FLOW-119), refusals, and the viewer's static rows. FLOW-139c: the cards and the payments page.

// FLOW-139c: the loan page is one page of cards; every payment is on /loans/:id/payments.
function renderLoan(store: MemoryLoanStore, loanId: string, wrap: (ui: ReactNode) => ReactNode = (ui) => ui, path = "") {
  return renderWithProviders(
    <Routes>
      <Route path="/loans/:loanId" element={wrap(<LoanDetailScreen store={store} today="2026-10-09" />)} />
      <Route path="/loans/:loanId/payments" element={wrap(<LoanDetailScreen store={store} today="2026-10-09" view="payments" />)} />
      <Route path="/loans" element={<p>רשימת ההלוואות</p>} />
    </Routes>,
    { route: `/loans/${loanId}${path === "" ? "" : `/${path}`}` },
  );
}

function toast(text: string | RegExp) {
  return screen.getAllByRole("status", { hidden: true }).find((node) => (typeof text === "string" ? node.textContent.includes(text) : text.test(node.textContent)));
}

describe("loan page: project (FLOW-119 on the loan page)", () => {
  it("moves the loan to another project, then ביטול puts it back", async () => {
    const store = sampleLoanStore();
    renderLoan(store, "loan-mortgage");
    fireEvent.click(screen.getByRole("button", { name: /^פרויקט שיפוץ דוגמה 12/ }));
    expect(screen.getByRole("radio", { name: /^שיפוץ דוגמה 12/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: /^בית דוגמה 9/ }));
    await waitFor(() => { expect(toast("ההלוואה שויכה לפרויקט")).toBeDefined(); });
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "פרויקט" })).not.toBeInTheDocument(); });
    expect(screen.getByRole("button", { name: /^פרויקט בית דוגמה 9/ })).toBeInTheDocument();
    const undo = within(toast("ההלוואה שויכה לפרויקט") as HTMLElement).getByRole("button", { name: "ביטול", hidden: true });
    fireEvent.click(undo);
    await waitFor(() => { expect(screen.getByRole("button", { name: /^פרויקט שיפוץ דוגמה 12/ })).toBeInTheDocument(); });
  });

  it("clears the project with ללא פרויקט", async () => {
    const store = sampleLoanStore();
    renderLoan(store, "loan-mortgage");
    fireEvent.click(screen.getByRole("button", { name: /^פרויקט שיפוץ דוגמה 12/ }));
    fireEvent.click(screen.getByRole("radio", { name: "ללא פרויקט" }));
    await waitFor(() => { expect(toast("ההלוואה הוסרה מהפרויקט")).toBeDefined(); });
    expect(store.read("loan-mortgage")).toMatchObject({ phase: "ready", bundle: { loan: { projectId: null } } });
  });

  it("closes without a write on the checked row", async () => {
    const store = sampleLoanStore();
    const update = vi.spyOn(store, "update");
    renderLoan(store, "loan-mortgage");
    fireEvent.click(screen.getByRole("button", { name: /^פרויקט שיפוץ דוגמה 12/ }));
    fireEvent.click(screen.getByRole("radio", { name: /^שיפוץ דוגמה 12/ }));
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "פרויקט" })).not.toBeInTheDocument(); });
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps the sheet and names a permission refusal", async () => {
    const store = sampleLoanStore({ refuse: { update: "forbidden" } });
    renderLoan(store, "loan-mortgage");
    fireEvent.click(screen.getByRole("button", { name: /^פרויקט שיפוץ דוגמה 12/ }));
    fireEvent.click(screen.getByRole("radio", { name: /^בית דוגמה 9/ }));
    await waitFor(() => { expect(toast("אין הרשאה לעדכן הלוואה.")).toBeDefined(); });
    expect(screen.getByRole("dialog", { name: "פרויקט" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /^שיפוץ דוגמה 12/ })).toHaveAttribute("aria-checked", "true");
  });

  it("says the project is gone when its foreign key fails (23503)", async () => {
    const store = sampleLoanStore();
    vi.spyOn(store, "update").mockRejectedValueOnce(Object.assign(new Error("fk"), { code: "23503" }));
    renderLoan(store, "loan-mortgage");
    fireEvent.click(screen.getByRole("button", { name: /^פרויקט שיפוץ דוגמה 12/ }));
    fireEvent.click(screen.getByRole("radio", { name: /^בית דוגמה 9/ }));
    await waitFor(() => { expect(toast("הפרויקט לא נמצא.")).toBeDefined(); });
    expect(screen.getByRole("dialog", { name: "פרויקט" })).toBeInTheDocument();
  });

  it("waits for the save: other rows are disabled and Escape does not close", async () => {
    const store = sampleLoanStore();
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const real = store.update;
    vi.spyOn(store, "update").mockImplementation(async (id, patch) => { await hold; await real(id, patch); });
    renderLoan(store, "loan-mortgage");
    fireEvent.click(screen.getByRole("button", { name: /^פרויקט שיפוץ דוגמה 12/ }));
    fireEvent.click(screen.getByRole("radio", { name: /^בית דוגמה 9/ }));
    await waitFor(() => { expect(screen.getByRole("radio", { name: "ללא פרויקט" })).toHaveAttribute("aria-disabled", "true"); });
    fireEvent.keyDown(document, { key: "Escape" });
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 50); }); });
    expect(screen.getByRole("dialog", { name: "פרויקט" })).toBeInTheDocument();
    await act(async () => { release(); await Promise.resolve(); });
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "פרויקט" })).not.toBeInTheDocument(); });
  });
});

describe("loan page: states and the viewer", () => {
  it("shows a viewer static rows with no sheets and no delete", () => {
    renderLoan(sampleLoanStore(), "loan-bridge", (ui) => <ViewerPreview>{ui}</ViewerPreview>);
    expect(screen.getByRole("heading", { name: "הלוואת גישור" })).toBeInTheDocument();
    expect(screen.getByText("בית דוגמה 9")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^פרויקט/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^סטטוס/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "מחיקת ההלוואה" })).not.toBeInTheDocument();
  });

  it("leads a paid-off loan with נפרעה and its date only, and changes its status from there (FLOW-138, FLOW-356)", async () => {
    renderLoan(sampleLoanStore(), "loan-old", undefined, "");
    expect(screen.getAllByText(/^נפרעה · \d\d\/\d\d\/\d{4}$/)[0]).toBeInTheDocument();
    expect(screen.queryByText("יתרה היום")).not.toBeInTheDocument();
    expect(screen.queryByText(/^התשלום הבא/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "שינוי מצב" }));
    await waitFor(() => { expect(screen.getByRole("radio", { name: "נפרעה" })).toHaveAttribute("aria-checked", "true"); });
    // Reopening brings the balance back.
    fireEvent.click(screen.getByRole("radio", { name: "פעילה" }));
    await waitFor(() => { expect(screen.getByText("יתרה היום")).toBeInTheDocument(); });
  });

  it("offers the tint ניסיון חוזר on a failed read, not the filled one (FLOW-334)", () => {
    renderLoan(oneLoanStore("loan-mortgage", { phase: "error" }), "loan-mortgage");
    const retry = screen.getByRole("button", { name: "ניסיון חוזר" });
    expect(retry).toHaveClass("ui-btn-pill");
    expect(retry).not.toHaveClass("ui-btn-retry");
  });

  it("shows not found with a way back to the list", () => {
    renderLoan(sampleLoanStore(), "no-such-loan");
    expect(screen.getByText("ההלוואה לא נמצאה")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "לרשימת ההלוואות" }));
    expect(screen.getByText("רשימת ההלוואות")).toBeInTheDocument();
  });

  it("keeps a close date before the last payment inside the date sheet", async () => {
    const store = sampleLoanStore();
    vi.spyOn(store, "update").mockRejectedValueOnce(new Error("loan_payments_after_close"));
    renderLoan(store, "loan-bridge");
    fireEvent.click(screen.getByRole("button", { name: /^סטטוס/ }));
    fireEvent.click(screen.getByRole("radio", { name: "נפרעה" }));
    const dateSheet = screen.getByRole("dialog", { name: "תאריך פירעון" });
    expect(dateSheet).toHaveTextContent("התשלום האחרון שויך ב־01/10/2026. אי אפשר לבחור יום לפניו.");
    fireEvent.click(within(dateSheet).getByRole("button", { name: "החלה" }));
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "תאריך פירעון" })).toHaveTextContent("יש תשלום משויך אחרי התאריך הזה. בחרו תאריך מאוחר יותר.");
    });
  });

  it("shows payment amounts without a minus (DESIGN-RULES §3.7)", () => {
    renderLoan(sampleLoanStore(), "loan-mortgage");
    const [row] = screen.getAllByRole("link", { name: /\$5,240$/ });
    expect(row?.textContent).not.toMatch(/[-−]/);
  });

  it("checks the default row when the loan names the keyed category itself", async () => {
    const store = sampleLoanStore();
    await store.update("loan-mortgage", { categoryIds: { interest: "cat-interest" } });
    renderLoan(store, "loan-mortgage");
    fireEvent.click(screen.getByRole("button", { name: /^ריבית ריבית/ }));
    expect(screen.getByRole("radio", { name: "ברירת מחדל · ריבית" })).toHaveAttribute("aria-checked", "true");
  });
});

function firstBack(): HTMLElement {
  const [button] = screen.getAllByRole("button", { name: /^חזרה/ });
  if (button == null) throw new Error("no Back button");
  return button;
}

describe("loan page: what it leads with (FLOW-139c)", () => {
  it("leads an amortizing loan with its balance, the next payment, the year's parts and the last three payments", () => {
    renderLoan(sampleLoanStore(), "loan-mortgage", undefined, "");
    expect(screen.getByText("יתרה היום")).toBeInTheDocument();
    expect(screen.getByText(/^נפרע \$[\d,]+ מתוך \$240,000 · לתשלום עד \d{4}$/)).toBeInTheDocument();
    expect(screen.getByText(/^התשלום הבא · 01\/11$/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "שולם השנה" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "3 התשלומים האחרונים" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "כל התשלומים" })).toHaveAttribute("href", "/loans/loan-mortgage/payments");
  });

  it("opens the part's category sheet from its שולם השנה row", async () => {
    renderLoan(sampleLoanStore(), "loan-mortgage", undefined, "");
    fireEvent.click(screen.getByRole("button", { name: /^ריבית ריבית/ }));
    expect(await screen.findByRole("dialog", { name: "ריבית" })).toBeInTheDocument();
  });

  it("opens the rate sheet from a rate change row, and the ריבית row for a new rate", async () => {
    const store = sampleLoanStore();
    await store.saveRate({ id: "loan-bridge", companyId: "company-sample" }, { effectiveDate: "2026-09-01", annualRatePpm: 112_500 });
    renderLoan(store, "loan-bridge", undefined, "");
    expect(screen.getByRole("heading", { name: "שינויי ריבית" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^מ־01\/09\/2026/ }));
    expect(await screen.findByRole("dialog", { name: "שינוי ריבית" })).toBeInTheDocument();
  });

  it("leaves out a part at $0, and leads the bridge loan with its interest (design r1)", () => {
    const { container } = renderLoan(sampleLoanStore(), "loan-bridge", undefined, "");
    expect(container.querySelector(".ui-loan-next-card")).toHaveTextContent("$1,837.50");
    expect(screen.getByRole("button", { name: /^ריבית ריבית/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^קרן/ })).not.toBeInTheDocument();
    expect(screen.getByText(/^ריבית בלבד: הקרן \(\$210,000\) תיפרע בסוף, 01\/2027$/)).toBeInTheDocument();
  });

  it("shows whole dollars when the loan pays whole dollars, cents when it pays cents", () => {
    const { container } = renderLoan(sampleLoanStore(), "loan-mortgage", undefined, "");
    const text = container.querySelector(".ui-loan-next-card")?.textContent ?? "";
    expect(text).toContain("$5,240");
    expect(text).not.toMatch(/\.\d\d/);
  });

  it("has no next payment for a demand loan, and says the balance is the principal", () => {
    renderLoan(sampleLoanStore(), "loan-partner", undefined, "");
    expect(screen.queryByText(/^התשלום הבא/)).not.toBeInTheDocument();
    expect(screen.getByText("יתרת קרן")).toBeInTheDocument();
  });
});

describe("loan page: all payments (FLOW-139c)", () => {
  it("lists every payment by year, newest year first, with the count and the total", () => {
    renderLoan(sampleLoanStore(), "loan-mortgage", undefined, "payments");
    expect(screen.getByText("כל התשלומים")).toBeInTheDocument();
    expect(screen.getByText("22 תשלומים מאז 01/2025 · שיפוץ דוגמה 12")).toBeInTheDocument();
    const years = screen.getAllByRole("heading", { level: 2 }).map((node) => node.textContent);
    expect(years).toEqual(["2026 · 10 תשלומים", "2025 · 12 תשלומים"]);
    expect(screen.getAllByRole("link", { name: /\$5,240$/ })).toHaveLength(22);
  });

  it("opens a payment's transaction, and steps Back to the loan page", async () => {
    renderLoan(sampleLoanStore(), "loan-mortgage", undefined, "payments");
    expect(screen.getAllByRole("link", { name: /\$5,240$/ })[0]).toHaveAttribute("href", expect.stringMatching(/^\/transactions\/txn-2026-10/));
    fireEvent.click(firstBack());
    expect(await screen.findByText("יתרה היום")).toBeInTheDocument();
  });

  it("leaves the principal out of an interest-only payment's split", () => {
    renderLoan(sampleLoanStore(), "loan-bridge", undefined, "payments");
    const rows = screen.getAllByRole("link");
    expect(rows.some((row) => row.textContent.includes("קרן"))).toBe(false);
    expect(rows.some((row) => row.textContent.includes("ריבית $"))).toBe(true);
  });
});
