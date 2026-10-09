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
  supplier_name: index === 0 ? "מנופים לדוגמה בע״מ" : `ספק ${String(index + 1)}`,
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

/**
 * FLOW-334: the rows sit under one head per project, with its count and total; each row's hint is
 * only its category. A line with no project gets the "בלי פרויקט" head. A long name wraps to two
 * lines before it cuts, and an income line counts green in its head.
 */
const byProject: FiledTodayRow[] = [
  { ...filedLine, id: "t-p1", supplier_name: "חומרי בניין לדוגמה", amount_net: -350_000n },
  { ...filedLine, id: "t-p2", supplier_name: "הובלות לדוגמה", project_name: "שיפוץ דירה ביאליק 8 חולון, שלב ב׳ – גמרים וריצוף", category_name: "הובלה", amount_net: -120_000n },
  { ...filedLine, id: "t-p3", supplier_name: "צבעים לדוגמה", amount_net: -84_050n },
  { ...filedLine, id: "t-p4", supplier_name: "לקוח לדוגמה", category_name: "עבודות", direction: "income", amount_net: 1_200_000n },
  { ...filedLine, id: "t-p5", supplier_name: "עמלת בנק", project_name: null, category_name: "עמלות", amount_net: -2_500n, source: "mercury" },
];

function filedByProject() {
  return (
    <StoryRoute entry="/review/filed" tabs>
      <ExampleBar />
      <FiledTodayScreen sample={byProject} />
    </StoryRoute>
  );
}

export const FiledTodayByProject: Story = { name: "Filed today, by project", render: filedByProject };
export const FiledTodayByProjectDark: Story = { name: "Filed today, by project (dark)", render: filedByProject, globals: { theme: "dark" } };
export const FiledTodayByProject320: Story = {
  name: "Filed today, by project (320)",
  render: filedByProject,
  parameters: { viewport: { defaultViewport: "flow320" } },
};
export const FiledTodayByProjectDark320: Story = {
  name: "Filed today, by project (dark, 320)",
  render: filedByProject,
  globals: { theme: "dark" },
  parameters: { viewport: { defaultViewport: "flow320" } },
};
