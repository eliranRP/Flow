import type { Meta, StoryObj } from "@storybook/react";
import { Route, Routes } from "react-router-dom";
import { ProjectCategoryScreen } from "./flow-screens";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const categorySample = {
  categoryName: "חומרים",
  projectName: "וילה רעננה",
  rows: [
    { id: "t1", description: "חומרי בניין השרון", doc_date: "2026-09-14", amount_net: -8_500_000n },
    { id: "t2", description: "מלט וחול", doc_date: "2026-09-20", amount_net: -21_500_000n },
  ],
};

export const ProjectCategory: Story = {
  render: () => (
    <StoryRoute entry="/projects/a/categories/c1">
      <ExampleBar />
      <ProjectCategoryScreen sample={categorySample} backTo="/projects/a" />
    </StoryRoute>
  ),
};

/** FLOW-107. Loan payments show their parts in the hint; one waits for review. */
const loanCategorySample = {
  categoryName: "תשלומי הלוואה",
  projectName: "וילה רעננה",
  rows: [
    { id: "l1", description: "Northgate Home Loans", doc_date: "2026-09-05", amount_net: -245_000n },
    { id: "l2", description: "Northgate Home Loans", doc_date: "2026-08-05", amount_net: -245_000n },
    { id: "l3", description: "Northgate Home Loans", doc_date: "2026-07-05", amount_net: -245_000n },
  ],
  loanMarks: { l1: "split", l2: "split", l3: "review" } as const,
};

export const ProjectCategoryLoanSplit: Story = {
  render: () => (
    <StoryRoute entry="/projects/a/categories/c1">
      <ExampleBar />
      <ProjectCategoryScreen sample={loanCategorySample} backTo="/projects/a" />
    </StoryRoute>
  ),
};

export const ProjectCategoryEmpty: Story = {
  render: () => (
    <StoryRoute entry="/projects/a/categories/c1">
      <ExampleBar />
      <ProjectCategoryScreen
        sample={{ categoryName: "חומרים", projectName: "וילה רעננה", rows: [] }}
        backTo="/projects/a"
      />
    </StoryRoute>
  ),
};

export const ProjectCategoryError: Story = {
  render: () => (
    <StoryRoute entry="/projects/a/categories/c1?preview=error">
      <ExampleBar />
      <Routes>
        <Route path="/projects/:projectId/categories/:categoryId" element={<ProjectCategoryScreen />} />
      </Routes>
    </StoryRoute>
  ),
};
