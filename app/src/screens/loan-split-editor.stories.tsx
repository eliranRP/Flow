import type { Meta, StoryObj } from "@storybook/react";
import { expect, fireEvent, waitFor, within } from "@storybook/test";
import { useState } from "react";
import type { LoanCategory } from "./loan-detail-data";
import type { LoanChoice } from "./loan-match-api";
import { LoanSplitEditor } from "./loan-split-editor";

/**
 * FLOW-106 §3.4, "חלוקת התשלום": the split editor that "חלוקה אחרת" opens from the loan match
 * sheet. Invented loans, categories and amounts.
 */
const MORTGAGE: LoanChoice = {
  id: "loan-1",
  name: "משכנתא לדוגמה",
  currency: "USD",
  principalMinor: 10_000_000,
  annualRatePpm: 60_000,
  termMonths: 360,
  startDate: "2026-02-01",
  paymentMinor: 59_955,
  escrowMinor: 0,
  balanceMinor: 9_000_000n,
};
const DEMAND: LoanChoice = {
  ...MORTGAGE,
  id: "loan-2",
  name: "הלוואה לפי דרישה",
  kind: "demand",
  termMonths: null,
  paymentMinor: null,
};
const CATEGORIES: LoanCategory[] = [
  { id: "cat-fees", name: "עמלות הלוואה", kind: "expense", loanPart: "fees", excludedFromPnl: false, hidden: false },
  { id: "cat-bank", name: "עמלות בנק", kind: "expense", loanPart: null, excludedFromPnl: false, hidden: false },
];

type EditorArgs = { lineMinor: number; demand?: boolean; twoLoans?: boolean };

/** Args stay plain JSON: Storybook cannot serialise bigint amounts. */
function Editor({ lineMinor, demand = false, twoLoans = false }: EditorArgs) {
  const [open, setOpen] = useState(true);
  const loans = demand ? [DEMAND] : twoLoans ? [MORTGAGE, DEMAND] : [MORTGAGE];
  return (
    <LoanSplitEditor
      open={open}
      onOpenChange={setOpen}
      loans={loans}
      payments={{}}
      line={{ transactionId: "txn-1", docDate: "2026-06-01", lineMinor: BigInt(lineMinor), currency: "USD" }}
      categories={CATEGORIES}
      onSave={() => undefined}
    />
  );
}

const meta = {
  title: "Screens/Loan split editor",
  component: Editor,
  args: { lineMinor: 60_090 },
} satisfies Meta<typeof Editor>;

export default meta;
type Story = StoryObj<typeof meta>;

const dark390 = { globals: { theme: "dark" } };
const light320 = { parameters: { viewport: { defaultViewport: "flow320" } } };
const sheet = () => within(document.body);

/** One installment by the schedule; the line's extra cents go to principal. */
export const Schedule: Story = {};
export const ScheduleDark: Story = { ...dark390 };
export const Schedule320: Story = { ...light320 };

/** Fees off the top: the picker asks where they go, and offers to keep the pick on the loan. */
export const WithFees: Story = {
  play: async () => {
    const body = sheet();
    await fireEvent.change(await body.findByLabelText("עמלות"), { target: { value: "1.35" } });
    await fireEvent.change(body.getByLabelText("קטגוריה לעמלות"), { target: { value: "cat-bank" } });
    await expect(body.getByRole("switch", { name: "לשמור להלוואה הזו" })).toBeChecked();
  },
};
export const WithFeesDark: Story = { ...WithFees, ...dark390 };
export const WithFees320: Story = { ...WithFees, ...light320 };

/** Fees typed, no category yet: שמירה waits and says why. */
export const FeesCategoryMissing: Story = {
  play: async () => {
    const body = sheet();
    await fireEvent.change(await body.findByLabelText("עמלות"), { target: { value: "1.35" } });
    await expect(body.getByText("בחרו לאן נרשמות העמלות.")).toBeVisible();
  },
};

/** A catch-up line: three installments together, with their dates under the stepper. */
export const ThreeInstallments: Story = {
  args: { lineMinor: 179_865 },
  play: async () => {
    const body = sheet();
    const more = await body.findByRole("button", { name: "יותר, מספר תשלומים" });
    await fireEvent.click(more);
    await fireEvent.click(more);
    await waitFor(() => expect(body.getByRole("spinbutton", { name: "מספר תשלומים" })).toHaveAttribute("aria-valuenow", "3"));
  },
};
export const ThreeInstallments320: Story = { ...ThreeInstallments, ...light320 };

/** The lender's own parts, still short of the line: שמירה waits. */
export const ExactShort: Story = {
  play: async () => {
    const body = sheet();
    await fireEvent.click(await body.findByRole("radio", { name: "סכומים מדויקים" }));
    await fireEvent.change(body.getByLabelText("סכום, קרן"), { target: { value: "50" } });
    await expect(body.getByText(/חסרים/)).toBeVisible();
  },
};
export const ExactShortDark: Story = { ...ExactShort, ...dark390 };
export const ExactShort320: Story = { ...ExactShort, ...light320 };

/** The parts pass the line. */
export const ExactOver: Story = {
  play: async () => {
    const body = sheet();
    await fireEvent.click(await body.findByRole("radio", { name: "סכומים מדויקים" }));
    await fireEvent.change(body.getByLabelText("סכום, קרן"), { target: { value: "200" } });
    await expect(body.getByText(/יותר מסכום השורה/)).toBeVisible();
  },
};

/** A demand loan: its accrued interest, no installments. */
export const Demand: Story = { args: { demand: true, lineMinor: 100_000 } };
export const DemandDark: Story = { args: { demand: true, lineMinor: 100_000 }, ...dark390 };

/** Two loans that can take the line: the editor asks which one. */
export const TwoLoans: Story = { args: { twoLoans: true } };
