import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "@storybook/test";
import { useState } from "react";
import type { TransactionLoanSplit } from "@flow/shared";
import { LoanMatchSampleProvider, type LoanMatchApi } from "./loan-match-api";
import { TransactionScreen } from "./flow-screens";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar, storyBody } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/* FLOW-114 option B: a payment matched to a loan shows as one row in place of the category row.
   Invented data: a 6,200 payment on an invented mortgage, split 4,150 / 1,630 / 380 / 40. */
const LOAN_TXN = {
  id: "t-loan",
  description: "בנק לדוגמה",
  direction: "expense",
  doc_date: "2026-10-01",
  amount_gross: -620_000n,
  amount_net: -620_000n,
  vat_amount: 0n,
  vat_status: "source",
  doc_kind: "expense",
  source: "manual",
  project_id: "gefen",
  project_name: "הגפן 12",
  category_id: "c-loan",
  category_name: "תשלום הלוואה",
  supplier_name: "בנק לדוגמה",
  customer_name: null,
  review_status: "approved",
  paid: true,
  open_gross_agorot: null,
  pnl_fixed: true,
} as const;

const LOAN_SPLIT: TransactionLoanSplit = {
  loan_id: "loan-gefen",
  loan_name: "משכנתא לדוגמה",
  needs_review: false,
  by_parts: true,
  parts: [
    { part: "interest", amount_minor: 163_000n, in_pnl: true },
    { part: "escrow", amount_minor: 38_000n, in_pnl: true },
    { part: "principal", amount_minor: 415_000n, in_pnl: false },
    { part: "fees", amount_minor: 4_000n, in_pnl: true },
  ],
};

function loanStoryApi({ currency = "ILS", saveFails = false }: { currency?: string; saveFails?: boolean } = {}): LoanMatchApi {
  const stored = LOAN_SPLIT.parts.map((part) => ({
    part: part.part,
    amountMinor: part.amount_minor,
    scheduledMinor: part.amount_minor,
    categoryId: part.part === "fees" ? "c-fees" : null,
    needsReview: false,
  }));
  return {
    read: () => Promise.resolve({
      companyId: "co-sample",
      lineMinor: 620_000n,
      currency,
      splits: [],
      byParts: false,
      loans: [{
        id: "loan-gefen",
        name: "משכנתא לדוגמה",
        currency,
        principalMinor: 100_000_000,
        annualRatePpm: 50_000,
        termMonths: 360,
        startDate: "2026-01-01",
        paymentMinor: 620_000,
        escrowMinor: 38_000,
        balanceMinor: 90_000_000n,
        categoryIds: { principal: "c-loan" },
      }],
      categoryIds: { principal: "c-loan" },
    }),
    readStored: () => Promise.resolve({ lineMinor: 620_000n, currency, loanCurrency: currency, parts: stored }),
    readCategories: () => Promise.resolve([
      { id: "c-fees", name: "עמלות בנק", kind: "expense", loanPart: null, excludedFromPnl: false, hidden: false },
      { id: "c-other", name: "הוצאות אחרות", kind: "expense", loanPart: null, excludedFromPnl: false, hidden: false },
    ]),
    setFeesCategory: () => Promise.resolve(),
    save: () => (saveFails ? Promise.reject(new Error("loan balance exceeded")) : Promise.resolve()),
    clear: () => Promise.resolve({
      loanId: "loan-gefen",
      parts: stored.map((part) => ({
        part: part.part,
        amount_minor: Number(part.amountMinor),
        scheduled_minor: Number(part.scheduledMinor),
        category_id: part.categoryId,
        needs_review: false,
      })),
    }),
  };
}

function LoanMatchStory({ currency = "ILS", saveFails = false, viewer = false, loanName = "משכנתא לדוגמה" }: { currency?: string; saveFails?: boolean; viewer?: boolean; loanName?: string }) {
  const [api] = useState(() => loanStoryApi({ currency, saveFails }));
  return (
    <StoryRoute entry="/transactions/t-loan" viewer={viewer}>
      <ExampleBar />
      <LoanMatchSampleProvider api={api} initial={{ ...LOAN_SPLIT, loan_name: loanName }} loanNames={{ "loan-gefen": loanName }}>
        <TransactionScreen
          sample={{ ...LOAN_TXN, currency, loan_split: { ...LOAN_SPLIT, loan_name: loanName } }}
          sampleProjects={[{ id: "gefen", name: "הגפן 12" }]}
          sampleCategories={[{ id: "c-loan", name: "תשלום הלוואה" }]}
        />
      </LoanMatchSampleProvider>
    </StoryRoute>
  );
}

const LOAN_ROW = /^תשלום הלוואה · משכנתא לדוגמה/;

/** Matched: one row, "תשלום הלוואה · <loan>" with the part count under it. */
export const TransactionLoanMatched: Story = {
  name: "Loan payment matched",
  render: () => <LoanMatchStory />,
};

/**
 * The row opens the split sheet: the parts and the total as static amounts, "עריכת הפיצול" (the one
 * way to edit them, FLOW-362) and a quiet ביטול השיוך.
 */
export const TransactionLoanEditing: Story = {
  name: "Loan payment, split sheet",
  parameters: { viewport: { defaultViewport: "flow375-se" } },
  render: () => <LoanMatchStory />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: LOAN_ROW }));
    const dialog = await storyBody(canvasElement).findByRole("dialog", { name: "משכנתא לדוגמה" });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "עריכת הפיצול" })).toBeEnabled());
  },
};

/**
 * FLOW-106 §3.4: "עריכת הפיצול" under the parts' total opens the split editor on the stored parts,
 * in סכומים מדויקים, for the loan the line is matched to.
 */
export const TransactionLoanEditSplit: Story = {
  name: "Loan payment, edit the split",
  render: () => <LoanMatchStory />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: LOAN_ROW }));
    const body = storyBody(canvasElement);
    const sheet = await body.findByRole("dialog", { name: "משכנתא לדוגמה" });
    const edit = within(sheet).getByRole("button", { name: "עריכת הפיצול" });
    await waitFor(() => expect(edit).toBeEnabled());
    await userEvent.click(edit);
    const editor = await body.findByRole("dialog", { name: "פיצול התשלום" });
    await waitFor(() => expect(within(editor).getByLabelText("סכום, קרן")).toHaveValue("4,150"));
  },
};
export const TransactionLoanEditSplit320: Story = {
  ...TransactionLoanEditSplit,
  name: "Loan payment, edit the split, 320",
  parameters: { viewport: { defaultViewport: "flow320" } },
};
/** FLOW-362: at 375x667 the fees category and "לשמור להלוואה הזו" show above שמירה. */
export const TransactionLoanEditSplitSe: Story = {
  ...TransactionLoanEditSplit,
  name: "Loan payment, edit the split, 375x667",
  parameters: { viewport: { defaultViewport: "flow375-se" } },
};
export const TransactionLoanEditSplitDark: Story = {
  ...TransactionLoanEditSplit,
  name: "Loan payment, edit the split, dark",
  globals: { theme: "dark" },
};

/** The server's balance check refuses the save: an error toast, and the sheet keeps the values. */
export const TransactionLoanSaveError: Story = {
  name: "Loan payment, save refused by the balance check",
  parameters: { viewport: { defaultViewport: "flow375-se" } },
  render: () => <LoanMatchStory saveFails />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: LOAN_ROW }));
    const body = storyBody(canvasElement);
    const sheet = await body.findByRole("dialog", { name: "משכנתא לדוגמה" });
    const edit = within(sheet).getByRole("button", { name: "עריכת הפיצול" });
    await waitFor(() => expect(edit).toBeEnabled());
    await userEvent.click(edit);
    const dialog = await body.findByRole("dialog", { name: "פיצול התשלום" });
    const save = within(dialog).getByRole("button", { name: "שמירה" });
    await waitFor(() => expect(within(dialog).getByLabelText("סכום, קרן")).toHaveValue("4,150"));
    await userEvent.clear(within(dialog).getByLabelText("סכום, קרן"));
    await userEvent.type(within(dialog).getByLabelText("סכום, קרן"), "4100");
    await userEvent.clear(within(dialog).getByLabelText("סכום, ריבית"));
    await userEvent.type(within(dialog).getByLabelText("סכום, ריבית"), "1680");
    await userEvent.click(save);
    await body.findByText("התשלום גבוה מיתרת ההלוואה.");
  },
};

/** After ביטול השיוך: the category row is back, the שיוך row returns, and the toast offers undo. */
export const TransactionLoanUnmatched: Story = {
  name: "Loan payment unmatched, with undo",
  render: () => <LoanMatchStory />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: LOAN_ROW }));
    const body = storyBody(canvasElement);
    const dialog = await body.findByRole("dialog", { name: "משכנתא לדוגמה" });
    await userEvent.click(within(dialog).getByRole("button", { name: "ביטול השיוך" }));
    await body.findByText("השיוך בוטל");
    await within(canvasElement).findByRole("button", { name: /שיוך להלוואה/ });
  },
};

/** A viewer reads the row. */
export const TransactionLoanViewer: Story = {
  name: "Loan payment, viewer",
  render: () => <LoanMatchStory viewer />,
};

/** A viewer opens the parts read-only: no fields, no שמירה, no ביטול השיוך. */
export const TransactionLoanViewerSheet: Story = {
  name: "Loan payment, viewer reads the parts",
  parameters: { viewport: { defaultViewport: "flow375-se" } },
  render: () => <LoanMatchStory viewer />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: LOAN_ROW }));
    const dialog = await storyBody(canvasElement).findByRole("dialog", { name: "משכנתא לדוגמה" });
    await expect(within(dialog).queryByRole("button", { name: "שמירה" })).toBeNull();
  },
};

/** A dollar loan on a dollar line: the sheet shows $. */
export const TransactionLoanUsd: Story = {
  name: "Loan payment in dollars, split sheet",
  parameters: { viewport: { defaultViewport: "flow375-se" } },
  render: () => <LoanMatchStory currency="USD" />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: LOAN_ROW }));
    await storyBody(canvasElement).findByRole("dialog", { name: "משכנתא לדוגמה" });
  },
};

/** FLOW-115: a long loan name wraps to a second line at 320 instead of losing the name. */
const LONG_LOAN = "משכנתא לדוגמה על בניין המגורים ברחוב הארוך";
export const TransactionLoanLongName320: Story = {
  name: "Loan payment, long loan name, 320",
  parameters: { viewport: { defaultViewport: "flow320" } },
  render: () => <LoanMatchStory loanName={LONG_LOAN} />,
};
export const TransactionLoanLongNameDark320: Story = {
  ...TransactionLoanLongName320,
  name: "Loan payment, long loan name, dark 320",
  globals: { theme: "dark" },
};
