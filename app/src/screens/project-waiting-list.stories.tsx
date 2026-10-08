import type { ProjectWaitingRow } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react";
import { StoryRoute } from "../ui/story-route";
import { at320, dark } from "../ui/screen-stories-support";
import { ProjectWaitingList } from "./review-screen";

/** A project's לאישור list (FLOW-124, FLOW-125): a bank line gets the bank icon, a line out of the P&L the ⊘. Invented data. */
const meta = {
  title: "Screens/Project waiting list",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const line: ProjectWaitingRow = {
  review_id: null,
  transaction_id: "t-doc",
  description: "חשבונית 2231",
  doc_date: "2026-10-05",
  amount_net: 184_000n,
  direction: "expense",
  reason: null,
  project_id: "a",
  category_id: null,
  category_name: null,
  supplier_name: null,
  source: "sumit",
};

const rows: ProjectWaitingRow[] = [
  { ...line, transaction_id: "t-bank", description: "Home Depot #4471 Example City", source: "mercury" },
  { ...line, transaction_id: "t-out", description: "ריבית הלוואה לדוגמה", doc_date: "2026-10-03", amount_net: 41_000n, kept_out: true },
  line,
];

export const LineMarks: Story = {
  name: "Bank line and a line out of the P&L",
  render: () => (
    <StoryRoute entry="/review?project=a" tabs>
      <ProjectWaitingList rows={rows} search="" />
    </StoryRoute>
  ),
};
export const LineMarks320: Story = { ...LineMarks, name: "Line marks, 320", ...at320 };
export const LineMarksDark: Story = { ...LineMarks, name: "Line marks, dark", ...dark };
