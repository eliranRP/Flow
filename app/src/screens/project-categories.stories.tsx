import type { ProjectCategoryMonthRow, ProjectDetail } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react";
import { userEvent, within } from "@storybook/test";
import { SectionHead } from "../ui/layout";
import { StoryRoute } from "../ui/story-route";
import { at320, dark, exampleOnBand } from "../ui/screen-stories-support";
import { ProjectDetailScreen } from "./project-detail-screen";
import { ProjectCategories } from "./project-categories";

/**
 * FLOW-401 v5 "clean" (owner approved, 2026-10-08): a project's categories with name and amount
 * only. חשבונות folds its three bills into one row; חומרים and פינוי פסולת carry the up mark;
 * the water bill has not come yet. Invented data.
 */
const meta = {
  title: "Screens/Project categories",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const project: NonNullable<ProjectDetail> = {
  id: "a",
  name: "רחוב הדוגמה 12",
  status: "active",
  state_label: null,
  budget_agorot: null,
  income_agorot: 0n,
  direct_agorot: 1_684_000n,
  shared_agorot: 0n,
  profit_agorot: -1_684_000n,
  categories: [
    { id: "c1", name: "חומרים", amount_agorot: 786_000n },
    { id: "c2", name: "קבלנים", amount_agorot: 600_000n },
    { id: "c3", name: "פינוי פסולת", amount_agorot: 195_000n },
    { id: "c4", name: "ביטוח", amount_agorot: 42_000n },
    { id: "c5", name: "חשמל", amount_agorot: 45_500n },
    { id: "c6", name: "גז", amount_agorot: 15_500n },
  ],
  pending_count: 0,
  pending_agorot: 0n,
  transactions: [],
};

const groups = { c5: "חשבונות", c6: "חשבונות", c7: "חשבונות" };

function month(id: string, name: string, flag: ProjectCategoryMonthRow["flag"], expected: number): ProjectCategoryMonthRow {
  return { id, name, group_name: null, currency: "ILS", this_month_minor: 0, months_minor: [], months_seen: 5, expected_minor: expected, typical_day: 12, flag };
}

const months: ProjectCategoryMonthRow[] = [
  month("c1", "חומרים", "high", 410_000),
  month("c3", "פינוי פסולת", "new", 0),
  month("c7", "מים", "missing", 9_000),
];

function List({ withMonth = true }: { withMonth?: boolean }) {
  return (
    <StoryRoute entry="/projects/a" tabs>
      <SectionHead title="הוצאות לפי קטגוריה" />
      <ProjectCategories project={project} search="" sampleGroups={groups} sampleMonths={withMonth ? months : undefined} />
    </StoryRoute>
  );
}

export const Month: Story = { name: "Month: up marks, group folded", render: () => <List /> };
export const Month320: Story = { ...Month, name: "Month, 320", ...at320 };
export const MonthDark: Story = { ...Month, name: "Month, dark", ...dark };

export const GroupOpen: Story = {
  name: "Month: group open, a bill not in yet",
  render: () => <List />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: /חשבונות/ }));
  },
};
export const GroupOpen320: Story = { ...GroupOpen, name: "Group open, 320", ...at320 };
export const GroupOpenDark: Story = { ...GroupOpen, name: "Group open, dark", ...dark };

/** FLOW-406: a parent folds its sub-categories, and its own lines sit last as "בלי תת-קטגוריה". */
const parentRow = (id: string, name: string, parent_id: string | null = null) => ({ id, name, kind: "expense" as const, hidden: false, is_default: false, parent_id });
export const ParentOpen: Story = {
  name: "Parent open, its own lines last",
  render: () => (
    <StoryRoute entry="/projects/a" tabs>
      <SectionHead title="הוצאות לפי קטגוריה" />
      <ProjectCategories
        project={{ ...project, categories: [...project.categories, { id: "c8", name: "תחזוקה", amount_agorot: 30_000n }] }}
        search=""
        sampleCategories={[parentRow("c1", "חומרים"), parentRow("c8", "תחזוקה"), parentRow("c5", "חשמל", "c8"), parentRow("c6", "גז", "c8")]}
        sampleMonths={[]}
      />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: /תחזוקה/ }));
  },
};

/** Longer periods: no marks and no "—" rows, only the groups. */
export const Quarter: Story = { name: "3 months: no marks", render: () => <List withMonth={false} /> };

/** The whole project page in the month view: the band and its period bar above the categories. */
export const FullPage: Story = {
  name: "Month: the whole project page",
  render: () => (
    <StoryRoute entry="/projects/a?period=month" tabs>
      <ProjectDetailScreen example={exampleOnBand} sample={project} sampleCategories={{ groups, months }} />
    </StoryRoute>
  ),
};
export const FullPage320: Story = { ...FullPage, name: "Whole page, 320", ...at320 };
