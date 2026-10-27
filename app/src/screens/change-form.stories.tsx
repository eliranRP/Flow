import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { ChangeForm } from "./flow-screens";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

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
  supplier = "חומרי בניין לדוגמה",
  projects = changeProjects,
  categories = changeCategories,
  initialQuery,
  loading,
  saveError,
  split,
  splitTitle,
  jev,
  missing,
}: {
  entry?: string;
  projectId?: string;
  categoryId?: string;
  suggestionId?: string;
  suggestionCategoryId?: string;
  supplier?: string;
  projects?: { id: string; name: string; code?: string; recent?: string; group?: string }[];
  categories?: typeof changeCategories;
  initialQuery?: string;
  loading?: boolean;
  saveError?: boolean;
  split?: boolean;
  splitTitle?: string;
  jev?: { project?: boolean; category?: boolean };
  missing?: boolean;
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
          ...(missing ? { missing } : {}),
        }}
      />
    </StoryRoute>
  );
}

export const ChangeSheet: Story = {
  name: "Summary (suggested)",
  render: () => <ChangeStory />,
  globals: {
    viewport: {
      value: "flow390-short",
      isRotated: false
    }
  },
};

/** FLOW-704: Jev's fill says הצעת Jev on שינוי שיוך, as on the card. */
export const ChangeJevSummary: Story = {
  name: "Summary (Jev fill)",
  render: () => <ChangeStory jev={{ project: true, category: true }} />,
};

export const ChangeProjectPicker: Story = {
  name: "Project picker",
  render: () => <ChangeStory entry="/review/change?item=r1&pick=project" />,
  globals: {
    viewport: {
      value: "flow390-short",
      isRotated: false
    }
  },
};

/** Decision 0221: on לאישור a row tap is the pick; there is no שמירה, and the summary shows it. */
export const ChangeProjectSavesOnPick: Story = {
  name: "Project picker, a tap saves",
  render: () => <ChangeStory entry="/review/change?item=r1&pick=project" />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole("radio", { name: /וילה/ }));
    await expect(body.queryByRole("button", { name: "שמירה" })).not.toBeInTheDocument();
    await expect(await body.findByRole("button", { name: /^פרויקט: וילה/ })).toBeInTheDocument();
  },
};

/** Decision 0221: a category tap saves too. */
export const ChangeCategorySavesOnPick: Story = {
  name: "Category picker, a tap saves",
  render: () => <ChangeStory entry="/review/change?item=r1&pick=category" />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole("radio", { name: /הובלה/ }));
    await expect(await body.findByRole("button", { name: /^קטגוריה: הובלה/ })).toBeInTheDocument();
  },
};

/** FLOW-971: closing with both fields missing names each one under its row, with a red edge. */
export const ChangeFieldErrors: Story = {
  name: "Summary, fields missing",
  render: () => <ChangeStory projectId="" categoryId="" suggestionId="" suggestionCategoryId="" missing />,
};

export const ChangeProjectLoading: Story = {
  name: "Project picker loading",
  render: () => <ChangeStory entry="/review/change?item=r1&pick=project" loading />,
  globals: {
    viewport: {
      value: "flow390-short",
      isRotated: false
    }
  },
};

export const ChangeCategoryPicker: Story = {
  name: "Category picker",
  render: () => <ChangeStory entry="/review/change?item=r1&pick=category" />,
  globals: {
    viewport: {
      value: "flow390-short",
      isRotated: false
    }
  },
};

const reversalCategories = [
  ...changeCategories,
  { id: "i1", name: "שכירות", hidden: false, kind: "income" },
  { id: "i2", name: "דמי ניהול", hidden: false, kind: "income" },
];

export const ChangeReversalPicker: Story = {
  name: "Category picker with reversals",
  render: () => <ChangeStory entry="/review/change?item=r1&pick=category" categories={reversalCategories} />,
  globals: {
    viewport: {
      value: "flow390-short",
      isRotated: false
    }
  },
};

export const ChangeSaveError: Story = {
  name: "Save error",
  render: () => <ChangeStory saveError />,
  globals: {
    viewport: {
      value: "flow390-short",
      isRotated: false
    }
  },
};

export const ChangeLongHebrew: Story = {
  name: "Long Hebrew",
  render: () => (
    <ChangeStory
      supplier="חומרי בניין לדוגמה בע״מ סניף גבעת הדוגמה"
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

/** FLOW-406 (picker): projects in a group sit under the group's name, then שאר הפרויקטים. */
const groupedChangeProjects = [
  { id: "holon", name: "בניין מגורים חולון", code: "P-14" },
  { id: "u1", name: "דירה 1", group: "בניין לדוגמה" },
  { id: "u2", name: "דירה 2", group: "בניין לדוגמה" },
  { id: "u3", name: "דירה 3", group: "בניין לדוגמה" },
  { id: "villa", name: "וילה רעננה", code: "P-02" },
  { id: "p17", name: "גן יבנה – תוספת קומה", code: "P-17" },
];

export const ChangeProjectPickerGrouped: Story = {
  name: "Project picker, grouped",
  render: () => <ChangeStory entry="/review/change?item=r1&pick=project" projects={groupedChangeProjects} />,
  globals: {
    viewport: {
      value: "flow390-short",
      isRotated: false
    }
  },
};
