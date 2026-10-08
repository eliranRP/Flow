import type { FiledTodayRow } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react";
import { FiledTodayScreen } from "./flow-screens";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar, filedTodayCount } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const sampleFiled: FiledTodayRow[] = Array.from({ length: filedTodayCount }, (_, index) => ({
  id: index === 0 ? "t-filed" : `t-filed-${String(index)}`,
  description: index === 0 ? "מלט" : "חשבונית",
  doc_date: "2026-09-29",
  amount_net: -350_000n,
  direction: "expense" as const,
  supplier_name: index === 0 ? "מנופי המרכז בע״מ" : `ספק ${String(index + 1)}`,
  project_name: "שיפוץ הרצל 12",
  category_name: "חומרים",
}));

export const FiledToday: Story = {
  render: () => (
    <StoryRoute entry="/review/filed" tabs>
      <ExampleBar />
      <FiledTodayScreen sample={sampleFiled} />
    </StoryRoute>
  ),
};

export const FiledTodayEmpty: Story = {
  render: () => (
    <StoryRoute entry="/review/filed?preview=empty" tabs>
      <ExampleBar />
      <FiledTodayScreen sample={[]} />
    </StoryRoute>
  ),
};

const filedLine: FiledTodayRow = {
  id: "t-line",
  description: "חשבונית",
  doc_date: "2026-09-29",
  amount_net: -350_000n,
  direction: "expense",
  supplier_name: "ספק לדוגמה",
  project_name: "שיפוץ הרצל 12",
  category_name: "חומרים",
};

/** FLOW-124 and FLOW-125: a bank line shows the bank icon; a line out of the P&L carries the ⊘. */
export const FiledTodayLineMarks: Story = {
  name: "Filed today, bank line and a line out of the P&L",
  render: () => (
    <StoryRoute entry="/review/filed" tabs>
      <ExampleBar />
      <FiledTodayScreen
        sample={[
          { ...filedLine, id: "t-bank", supplier_name: "Home Depot", source: "mercury" },
          { ...filedLine, id: "t-out", supplier_name: "ריבית בנק לדוגמה", category_name: "ריבית", source: "sumit", kept_out: true },
          { ...filedLine, id: "t-doc", source: "sumit" },
        ]}
      />
    </StoryRoute>
  ),
};
