import type { Meta, StoryObj } from "@storybook/react";
import { ChangeForm } from "./flow-screens";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ChangeSplitUnallocated: Story = {
  name: "Change split, unallocated",
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => (
    <ChangeStory
      supplier="עגורני החוף בע״מ"
      projectId=""
      categoryId=""
      suggestionId=""
      suggestionCategoryId=""
      split
      splitTitle="עלות משותפת · טרם פוצלה"
      projects={[
        { id: "p-alon", name: "בית הספר אלון", code: "P-01" },
        { id: "p-namal", name: "מחסן הנמל", code: "P-02" },
      ]}
      categories={[
        { id: "c1", name: "מלט", hidden: false, kind: "expense" },
        { id: "c2", name: "שינוע", hidden: false, kind: "expense" },
      ]}
    />
  ),
};

const changeProjects = [
  { id: "holon", name: "בניין מגורים חולון", code: "P-14" },
  { id: "p14", name: "מגדל משרדים פ״ת", code: "P-08", recent: "היום" },
  { id: "villa", name: "וילה רעננה", code: "P-02", recent: "אתמול" },
  { id: "p21", name: "בית פרטי כפר סבא", code: "P-21", recent: "לפני 3 ימים" },
  { id: "p03", name: "שיפוץ דירה ת״א", code: "P-03", recent: "לפני שבוע" },
  { id: "p17", name: "גן יבנה – תוספת קומה", code: "P-17" },
];

const changeCategories = [
  { id: "c1", name: "חומרים", hidden: false, kind: "expense" },
  { id: "c2", name: "ציוד והשכרה", hidden: false, kind: "expense" },
  { id: "c3", name: "הובלה", hidden: false, kind: "expense" },
  { id: "c4", name: "עבודה", hidden: true, kind: "expense" },
];

function ChangeStory({
  entry = "/review/change?item=r1",
  projectId = "holon",
  categoryId = "c1",
  suggestionId = "holon",
  suggestionCategoryId = "c1",
  supplier = "חומרי בניין השרון",
  projects = changeProjects,
  categories = changeCategories,
  initialQuery,
  loading,
  saveError,
  split,
  splitTitle,
  jev,
}: {
  entry?: string;
  projectId?: string;
  categoryId?: string;
  suggestionId?: string;
  suggestionCategoryId?: string;
  supplier?: string;
  projects?: typeof changeProjects;
  categories?: typeof changeCategories;
  initialQuery?: string;
  loading?: boolean;
  saveError?: boolean;
  split?: boolean;
  splitTitle?: string;
  jev?: { project?: boolean; category?: boolean };
} = {}) {
  return (
    <StoryRoute entry={entry}>
      <ExampleBar />
      <ChangeForm
        sample={{
          supplier,
          amount: "₪8,500",
          suggestionId,
          suggestionCategoryId,
          projectId,
          categoryId,
          projects,
          categories,
          ...(initialQuery != null ? { initialQuery } : {}),
          ...(loading ? { loading } : {}),
          ...(saveError ? { saveError } : {}),
          ...(split ? { split } : {}),
          ...(splitTitle != null ? { splitTitle } : {}),
          ...(jev ? { jev } : {}),
        }}
      />
    </StoryRoute>
  );
}

export const ChangeSheet: Story = {
  name: "Summary (suggested)",
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => <ChangeStory />,
};

/** FLOW-704: Jev's fill says הצעת Jev on שינוי שיוך, as on the card. */
export const ChangeJevSummary320: Story = {
  name: "Summary (Jev fill) 320",
  parameters: { viewport: { defaultViewport: "flow320" } },
  render: () => <ChangeStory jev={{ project: true, category: true }} />,
};

export const ChangeJevSummaryDark320: Story = {
  name: "Summary (Jev fill) dark 320",
  globals: { theme: "dark" },
  parameters: { viewport: { defaultViewport: "flow320" } },
  render: () => <ChangeStory jev={{ project: true, category: true }} />,
};

export const ChangeJevPicker320: Story = {
  name: "Project picker (Jev fill) 320",
  parameters: { viewport: { defaultViewport: "flow320" } },
  render: () => <ChangeStory entry="/review/change?item=r1&pick=project" jev={{ project: true }} />,
};

export const ChangeJevPickerDark320: Story = {
  name: "Project picker (Jev fill) dark 320",
  globals: { theme: "dark" },
  parameters: { viewport: { defaultViewport: "flow320" } },
  render: () => <ChangeStory entry="/review/change?item=r1&pick=project" jev={{ project: true }} />,
};

export const ChangeSummaryChanged: Story = {
  name: "Summary (changed)",
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => <ChangeStory projectId="villa" categoryId="c3" suggestionCategoryId="c1" />,
};

export const ChangeProjectPicker: Story = {
  name: "Project picker",
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => <ChangeStory entry="/review/change?item=r1&pick=project" />,
};

/** FLOW-325 §10 (option A): פיצול לפי קטגוריות under פיצול בין פרויקטים approves, then opens the parts editor. */
export const ChangeProjectPickerDark: Story = {
  name: "Project picker dark",
  globals: { theme: "dark" },
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => <ChangeStory entry="/review/change?item=r1&pick=project" />,
};

export const ChangeProjectPicker320: Story = {
  name: "Project picker 320",
  parameters: { viewport: { defaultViewport: "flow320" } },
  render: () => <ChangeStory entry="/review/change?item=r1&pick=project" />,
};

/** No category yet: the line cannot be approved, so the sheet offers no split by categories. */
export const ChangeProjectPickerNoCategory: Story = {
  name: "Project picker, no category",
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => <ChangeStory entry="/review/change?item=r1&pick=project" categoryId="" suggestionCategoryId="" />,
};

export const ChangeProjectSearching: Story = {
  name: "Project picker searching",
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => <ChangeStory entry="/review/change?item=r1&pick=project" initialQuery="ויל" />,
};

export const ChangeProjectEmpty: Story = {
  name: "Project picker no results",
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => <ChangeStory entry="/review/change?item=r1&pick=project" initialQuery="קסם" />,
};

export const ChangeProjectLoading: Story = {
  name: "Project picker loading",
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => <ChangeStory entry="/review/change?item=r1&pick=project" loading />,
};

export const ChangeCategoryPicker: Story = {
  name: "Category picker",
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => <ChangeStory entry="/review/change?item=r1&pick=category" />,
};

const reversalCategories = [
  ...changeCategories,
  { id: "i1", name: "שכירות", hidden: false, kind: "income" },
  { id: "i2", name: "דמי ניהול", hidden: false, kind: "income" },
];

export const ChangeReversalPicker: Story = {
  name: "Category picker with reversals",
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => <ChangeStory entry="/review/change?item=r1&pick=category" categories={reversalCategories} />,
};

export const ChangeReversalPicked: Story = {
  name: "Reversal picked, 320",
  parameters: { viewport: { defaultViewport: "flow320" } },
  render: () => <ChangeStory entry="/review/change?item=r1&pick=category" categories={reversalCategories} categoryId="i1" suggestionCategoryId="" />,
};

export const ChangeReversalSummary: Story = {
  name: "Reversal on the summary, 320",
  parameters: { viewport: { defaultViewport: "flow320" } },
  render: () => <ChangeStory categories={reversalCategories} categoryId="i1" suggestionCategoryId="" />,
};

/** FLOW-118: a kept-out income category filed through MCP stays marked החזר and sits in the reversal section. */
const keptOutReversalCategories = [
  ...reversalCategories,
  { id: "i3", name: "העברות בין חשבונות", hidden: false, kind: "income", excluded_from_pnl: true },
];

export const ChangeReversalKeptOutSummary: Story = {
  name: "Kept-out reversal on the summary, 320",
  parameters: { viewport: { defaultViewport: "flow320" } },
  render: () => <ChangeStory categories={keptOutReversalCategories} categoryId="i3" suggestionCategoryId="" />,
};

export const ChangeReversalKeptOutPicker: Story = {
  name: "Kept-out reversal in the picker, 320",
  parameters: { viewport: { defaultViewport: "flow320" } },
  render: () => <ChangeStory entry="/review/change?item=r1&pick=category" categories={keptOutReversalCategories} categoryId="i3" suggestionCategoryId="" />,
};

export const ChangeSaveError: Story = {
  name: "Save error",
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => <ChangeStory saveError />,
};

export const ChangeLongHebrew: Story = {
  name: "Long Hebrew",
  parameters: { viewport: { defaultViewport: "flow320" } },
  render: () => (
    <ChangeStory
      supplier="חומרי בניין השרון בע״מ סניף פתח תקווה"
      projectId="long"
      suggestionId="long"
      categoryId="long-cat"
      suggestionCategoryId="long-cat"
      projects={[
        {
          id: "long",
          name: "בניין מגורים חולון עם שם ארוך מאוד שלא נחתך באמצע המילה ברוחב צר",
          code: "P-14",
        },
        ...changeProjects,
      ]}
      categories={[
        { id: "long-cat", name: "חומרי בניין וציוד כבד להשכרה כולל הובלה ופריקה באתר", hidden: false, kind: "expense" },
        ...changeCategories,
      ]}
    />
  ),
};
