import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { Route, Routes } from "react-router-dom";
import { closingPaidLoanStore, oneLoanStore, sampleLoanStore } from "../dev/loan-detail-sample";
import { StoryRoute } from "../ui/story-route";
import { LoanDetailScreen } from "./loan-detail-screen";
import type { MemoryLoanStore } from "./loan-detail-store";

/** FLOW-106 B / FLOW-110. The loan page on invented loans; the day is pinned to 2026-10-09. */
const TODAY = "2026-10-09";

/** FLOW-139c: `path` opens the all-payments page ("payments"). */
function Page({ loanId, store, viewer = false, path = "", offline = false }: { loanId: string; store: () => MemoryLoanStore; viewer?: boolean; path?: string; offline?: boolean }) {
  const memory = store();
  return (
    <StoryRoute entry={`/loans/${loanId}${path === "" ? "" : `/${path}`}`} viewer={viewer}>
      <Routes>
        <Route path="/loans/:loanId" element={<LoanDetailScreen store={memory} today={TODAY} offlineSince={offline ? Date.UTC(2026, 9, 9, 6, 41) : undefined} />} />
        <Route path="/loans/:loanId/payments" element={<LoanDetailScreen store={memory} today={TODAY} view="payments" />} />
      </Routes>
    </StoryRoute>
  );
}

const meta = {
  title: "Screens/Loan page",
  component: Page,
  parameters: { flowRouter: false },
} satisfies Meta<typeof Page>;

export default meta;
type Story = StoryObj<typeof meta>;


function loan(id: string, options: Parameters<typeof oneLoanStore>[1] = {}, path = "") {
  return { args: { loanId: id, store: () => oneLoanStore(id, options), path } };
}

export const Amortizing: Story = { name: "Amortizing", ...loan("loan-mortgage") };
export const InterestOnlyRates: Story = {
  name: "Interest-only with rate changes",
  ...loan("loan-bridge"),
  // The סוג value stays whole at 320 and 393 (the Storybook tests run both widths): its row is a button
  // with the kind's words and no clipped line.
  play: async ({ canvasElement }) => {
    const kind = within(canvasElement).getByRole("button", { name: /^סוג/ });
    await expect(kind).toHaveTextContent("ריבית בלבד");
    await expect(kind.scrollWidth - kind.clientWidth).toBeLessThanOrEqual(1);
  },
};
/** FLOW-1046 (V3-Loan-Note): a loan whose payments wait for a check opens with הפרטים נכונים / עריכה. */
export const NoteWaitingCheck: Story = {
  name: "Note waiting for a check",
  ...loan("loan-note"),
  beforeEach: () => {
    try {
      window.localStorage.removeItem("flow.attention.loan:loan-note");
    } catch {
      // No storage: nothing to clear.
    }
  },
  play: async ({ canvasElement }) => {
    const card = within(canvasElement).getByRole("region", { name: "ממתין לבדיקה" });
    await expect(within(card).getByRole("button", { name: "הפרטים נכונים" })).toBeVisible();
    await expect(within(card).getByRole("link", { name: "עריכה" })).toBeVisible();
  },
};
export const Demand: Story = { name: "Demand", ...loan("loan-partner") };
/** FLOW-138 "Hide" (FLOW-356): נפרעה and its date lead; no balance and no next payment. */
export const PaidOffWithBalance: Story = { name: "Paid off with a balance left", ...loan("loan-old") };
export const Viewer: Story = { name: "Viewer", args: { loanId: "loan-bridge", store: () => oneLoanStore("loan-bridge"), viewer: true } };
export const Loading: Story = { name: "Loading", ...loan("loan-mortgage", { phase: "loading" }) };
export const LoadError: Story = { name: "Error", ...loan("loan-mortgage", { phase: "error" }) };
/** FLOW-962: offline, the page keeps its figures and says which moment they are from. */
export const Offline: Story = { name: "Offline", args: { loanId: "loan-mortgage", store: () => oneLoanStore("loan-mortgage"), offline: true } };

/** FLOW-139c, FLOW-1046: the paid payments, by year under one-line heads, newest first. */
export const Payments: Story = { name: "Payments, paid", ...loan("loan-mortgage", {}, "payments") };

/** FLOW-1046: the payments left on the schedule, by year, soonest first. */
export const PaymentsUpcoming: Story = {
  name: "Payments, upcoming",
  ...loan("loan-mortgage", {}, "payments"),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("radio", { name: /^הבאים · / }));
    await expect(within(canvasElement).getAllByText(/^צפוי · /).length).toBeGreaterThan(0);
  },
};

/** FLOW-1046: scrolled, the שולמו / הבאים segment docks into the compact bar. */
export const PaymentsDocked: Story = {
  name: "Payments, docked",
  ...loan("loan-mortgage", {}, "payments"),
  play: async ({ canvasElement }) => {
    window.scrollTo({ top: 600, behavior: "instant" });
    await waitFor(() => expect(canvasElement.querySelector(".ui-compact-dock")).toHaveAttribute("data-open"));
  },
};

function bodyOf(canvasElement: HTMLElement) {
  return within(canvasElement.ownerDocument.body);
}

/** FLOW-466: a project's loan says what it paid at closing; its sheet takes the settlement statement's amount. */
export const ClosingPaid: Story = { name: "Closing paid", args: { loanId: "loan-bridge", store: () => closingPaidLoanStore() } };
/** FLOW-473: a project's loan that was not paid out at closing (not a Sub2) has no closing row. */
export const ProjectLoanNotAtClosing: Story = {
  name: "Project loan, not paid out at closing",
  ...loan("loan-mortgage"),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("button", { name: /^פרויקט/ })).toBeInTheDocument();
    await expect(within(canvasElement).queryByText("סכום ששולם בסגירה")).toBeNull();
  },
};
export const ClosingPaidSheet: Story = {
  name: "Closing paid sheet",
  ...loan("loan-bridge"),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /^סכום ששולם בסגירה/ }));
    await expect(await bodyOf(canvasElement).findByRole("dialog", { name: "סכום ששולם בסגירה" })).toBeInTheDocument();
  },
};

/** FLOW-472: an amount above the loan says so when the field is left, before שמירה. */
export const ClosingPaidSheetError: Story = {
  name: "Closing paid sheet, error on blur",
  ...loan("loan-bridge"),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /^סכום ששולם בסגירה/ }));
    const sheet = await bodyOf(canvasElement).findByRole("dialog", { name: "סכום ששולם בסגירה" });
    const field = within(sheet).getByLabelText("סכום");
    await userEvent.type(field, "250000");
    await userEvent.tab();
    await expect(within(sheet).getByText("הסכום צריך להיות בין 0 ל־$210,000.")).toBeInTheDocument();
    await expect(field).toHaveAttribute("aria-invalid", "true");
  },
};

export const KindSheet: Story = {
  name: "Kind sheet",
  ...loan("loan-mortgage"),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /^סוג/ }));
    await expect(await bodyOf(canvasElement).findByRole("dialog", { name: "סוג ההלוואה" })).toBeInTheDocument();
  },
};

export const DeleteConfirm: Story = {
  name: "Delete confirm",
  ...loan("loan-mortgage"),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "מחיקת ההלוואה" }));
    await expect(await bodyOf(canvasElement).findByRole("dialog", { name: "למחוק את ההלוואה?" })).toBeInTheDocument();
  },
};

/** FLOW-962: a loan closed for a refinance leads with how it ended; no payments yet says what will appear. */
export const ClosedRefinance: Story = { name: "Closed for a refinance, no payments", ...loan("loan-closed") };

/** FLOW-962: סגירת ההלוואה asks why and the day, and says what follows. */
export const CloseSheet: Story = {
  name: "Close sheet",
  ...loan("loan-bridge"),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "סגירת ההלוואה" }));
    const sheet = await bodyOf(canvasElement).findByRole("dialog", { name: /^סגירת הלוואת גישור/ });
    await userEvent.click(within(sheet).getByRole("radio", { name: /מימון מחדש/ }));
    await expect(within(sheet).getByRole("radio", { name: /מימון מחדש/ })).toHaveAttribute("aria-checked", "true");
  },
};

/** FLOW-1046: ⋯ in the band opens the close sheet; closing shows the toast with ביטול. */
export const CloseToast: Story = {
  name: "Close sheet, toast with undo",
  ...loan("loan-bridge"),
  play: async ({ canvasElement }) => {
    const body = bodyOf(canvasElement);
    await userEvent.click(within(canvasElement).getAllByRole("button", { name: "פעולות להלוואה" })[0] as HTMLElement);
    const sheet = await body.findByRole("dialog", { name: /^סגירת הלוואת גישור/ });
    await userEvent.click(within(sheet).getByRole("button", { name: "סגירת ההלוואה" }));
    await expect(await body.findByRole("button", { name: "ביטול" })).toBeVisible();
  },
};

/** FLOW-962: a refinance names the new loan, and the closed head opens it. */
export const ClosedRefinanceLinked: Story = {
  name: "Closed for a refinance, linked",
  args: { loanId: "loan-bridge", store: () => sampleLoanStore() },
  play: async ({ canvasElement }) => {
    const body = bodyOf(canvasElement);
    await userEvent.click(within(canvasElement).getByRole("button", { name: "סגירת ההלוואה" }));
    await userEvent.click(within(await body.findByRole("dialog", { name: /^סגירת הלוואת גישור/ })).getByRole("radio", { name: /מימון מחדש/ }));
    await userEvent.click(body.getByRole("button", { name: /ההלוואה החדשה · לא חובה/ }));
    await userEvent.click(within(await body.findByRole("dialog", { name: "ההלוואה החדשה" })).getByRole("radio", { name: "משכנתא דוגמה" }));
    await userEvent.click(within(await body.findByRole("dialog", { name: /^סגירת הלוואת גישור/ })).getByRole("button", { name: "סגירת ההלוואה" }));
    await expect(await within(canvasElement).findByRole("link", { name: /משכנתא דוגמה/ })).toBeInTheDocument();
  },
};

/** FLOW-962: "מתי השינוי חל?" first; מתאריך… shows the day field (a past day allowed). */
export const RateFromDay: Story = {
  name: "Rate sheet, from a day",
  ...loan("loan-bridge"),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /^ריבית \d/ }));
    const sheet = await bodyOf(canvasElement).findByRole("dialog", { name: "קביעת ריבית" });
    await userEvent.click(within(sheet).getByRole("radio", { name: /מתאריך…/ }));
    await expect(within(sheet).getByRole("button", { name: /^מתאריך/ })).toBeInTheDocument();
  },
};

/** FLOW-1046 (V3-Loan): the band's balance, then the next payment, what was paid, then the last payments. */
export const CardsInOrder: Story = {
  name: "Cards in order",
  ...loan("loan-mortgage"),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    const order = [
      page.getByText("יתרה היום"),
      page.getByText(/^התשלום הבא · /),
      page.getByText("שולם מאז 01/2025"),
      page.getByText("3 התשלומים האחרונים"),
    ];
    for (let index = 1; index < order.length; index += 1) {
      const before = order[index - 1];
      const after = order[index];
      if (before == null || after == null) throw new Error("missing card");
      await expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  },
};
