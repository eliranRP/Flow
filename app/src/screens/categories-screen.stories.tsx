import type { CategoryRow } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react";
import { userEvent, within } from "@storybook/test";
import { CategoriesScreen } from "./flow-screens";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar, storyBody } from "../ui/screen-stories-support";

const sampleCategories: Array<CategoryRow & { count?: number }> = [
  { id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: true, count: 42 },
  { id: "c2", name: "ציוד והשכרה", kind: "expense", hidden: false, is_default: true, count: 8 },
  { id: "c3", name: "הובלה", kind: "expense", hidden: false, is_default: true, count: 5 },
  { id: "c4", name: "עבודה", kind: "expense", hidden: true, is_default: true, count: 1 },
  { id: "c5", name: "תקבול", kind: "income", hidden: false, is_default: true, count: 3 },
];

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const CategoriesList: Story = {
  render: () => (
    <StoryRoute entry="/settings/categories" tabs>
      <ExampleBar />
      <CategoriesScreen sample={sampleCategories} />
    </StoryRoute>
  ),
};

export const CategoriesHiddenCollapsed: Story = {
  render: () => (
    <StoryRoute entry="/settings/categories" tabs>
      <ExampleBar />
      <CategoriesScreen sample={sampleCategories} />
    </StoryRoute>
  ),
};

export const CategoriesHiddenExpanded: Story = {
  render: () => (
    <StoryRoute entry="/settings/categories" tabs>
      <ExampleBar />
      <CategoriesScreen sample={sampleCategories} hiddenOpen />
    </StoryRoute>
  ),
};

export const CategoriesNoneHidden: Story = {
  render: () => (
    <StoryRoute entry="/settings/categories" tabs>
      <ExampleBar />
      <CategoriesScreen sample={sampleCategories.filter((category) => !category.hidden)} />
    </StoryRoute>
  ),
};

const longHebrewCategories: Array<CategoryRow & { count?: number }> = [
  {
    id: "c1",
    name: "חומרי בניין וציוד השכרה לקבלני משנה באתר הוילה",
    kind: "expense",
    hidden: false,
    is_default: false,
    count: 124,
  },
  {
    id: "c2",
    name: "עבודות גמר ושיפוץ פנים כולל חשמל ואינסטלציה מלאה",
    kind: "expense",
    hidden: true,
    is_default: false,
    count: 52,
  },
];

export const CategoriesLongHebrew: Story = {
  parameters: { viewport: { defaultViewport: "flow320" } },
  render: () => (
    <StoryRoute entry="/settings/categories" tabs>
      <ExampleBar />
      <CategoriesScreen sample={longHebrewCategories} />
    </StoryRoute>
  ),
};

const keptOutCategories: Array<CategoryRow & { count?: number }> = [
  { id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: true, excluded_from_pnl: false, count: 42 },
  { id: "c6", name: "פיקדונות", kind: "expense", hidden: false, is_default: false, excluded_from_pnl: true, count: 3 },
  { id: "c7", name: "ריבית משכנתא", kind: "expense", hidden: false, is_default: true, excluded_from_pnl: false, loan_part: "interest", count: 12 },
  { id: "c8", name: "תשלומי הלוואה", kind: "expense", hidden: false, is_default: true, excluded_from_pnl: true, loan_part: "principal", count: 12 },
  { id: "c4", name: "עבודה", kind: "expense", hidden: true, is_default: true, excluded_from_pnl: true, count: 1 },
  { id: "c5", name: "תקבול", kind: "income", hidden: false, is_default: true, excluded_from_pnl: false, count: 3 },
];

export const CategoriesKeptOut: Story = {
  render: () => (
    <StoryRoute entry="/settings/categories" tabs>
      <ExampleBar />
      <CategoriesScreen sample={keptOutCategories} hiddenOpen />
    </StoryRoute>
  ),
};

export const CategoriesKeptOutMenu: Story = {
  render: () => (
    <StoryRoute entry="/settings/categories" tabs>
      <ExampleBar />
      <CategoriesScreen sample={keptOutCategories} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "עוד, חומרים" }));
    await storyBody(canvasElement).findByRole("dialog", { name: "חומרים" });
  },
};

export const CategoriesKeptOutBackMenu: Story = {
  render: () => (
    <StoryRoute entry="/settings/categories" tabs>
      <ExampleBar />
      <CategoriesScreen sample={keptOutCategories} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "עוד, פיקדונות" }));
    await storyBody(canvasElement).findByRole("dialog", { name: "פיקדונות" });
  },
};

export const CategoriesKeptOutLoanMenu: Story = {
  render: () => (
    <StoryRoute entry="/settings/categories" tabs>
      <ExampleBar />
      <CategoriesScreen sample={keptOutCategories} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "עוד, תשלומי הלוואה" }));
    await storyBody(canvasElement).findByRole("dialog", { name: "תשלומי הלוואה" });
  },
};

export const CategoriesKeptOutLongHebrew: Story = {
  parameters: { viewport: { defaultViewport: "flow320" } },
  render: () => (
    <StoryRoute entry="/settings/categories" tabs>
      <ExampleBar />
      <CategoriesScreen
        sample={longHebrewCategories.map((category) => ({ ...category, hidden: false, excluded_from_pnl: true, count: 1204 }))}
      />
    </StoryRoute>
  ),
};

export const CategoriesEmpty: Story = {
  render: () => (
    <StoryRoute entry="/settings/categories" tabs>
      <ExampleBar />
      <CategoriesScreen sample={[]} />
    </StoryRoute>
  ),
};

export const CategoriesError: Story = {
  render: () => (
    <StoryRoute entry="/settings/categories?preview=error" tabs>
      <ExampleBar />
      <CategoriesScreen />
    </StoryRoute>
  ),
};
