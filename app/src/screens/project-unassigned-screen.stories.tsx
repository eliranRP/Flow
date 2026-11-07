import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";
import { UNASSIGNED_LONG, UNASSIGNED_SAMPLE } from "./project-unassigned-sample";
import { ProjectUnassignedScreen } from "./project-unassigned-screen";

/** FLOW-1044 (board V3-Unassigned): the lines with no project. Invented names and amounts. */
const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const UnassignedRows: Story = {
  name: "Lines with no project",
  render: () => (
    <StoryRoute entry="/projects/unassigned" tabs>
      <ExampleBar />
      <ProjectUnassignedScreen sample={UNASSIGNED_SAMPLE} />
    </StoryRoute>
  ),
};

/** A pick in the sheet folds the row, and the toast offers ביטול. */
export const UnassignedAssigned: Story = {
  name: "Lines with no project, one assigned",
  render: UnassignedRows.render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getAllByRole("button", { name: "שיוך" })[0] as HTMLElement);
    const sheet = await within(document.body).findByRole("dialog", { name: "לאיזה פרויקט?" });
    await expect(within(sheet).getAllByRole("radio")[0]).toHaveTextContent("מוצע");
    await userEvent.click(within(sheet).getAllByRole("radio")[0] as HTMLElement);
    await expect(await within(document.body).findByText("שויך לLark Hill", undefined, { timeout: 4000 })).toBeInTheDocument();
    await expect(within(document.body).getByRole("button", { name: "ביטול" })).toBeInTheDocument();
  },
};

/** The picker, open on a line, with the project its category names first and "+ פרויקט חדש" last (FLOW-1093). */
export const UnassignedPicker: Story = {
  name: "Lines with no project, the project picker",
  render: UnassignedRows.render,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getAllByRole("button", { name: "שיוך" })[0] as HTMLElement);
    const sheet = await within(document.body).findByRole("dialog", { name: "לאיזה פרויקט?" });
    const create = within(sheet).getByRole("button", { name: "+ פרויקט חדש" });
    // Eight projects run past a phone's sheet, so the shot scrolls to the last row.
    create.scrollIntoView({ block: "end" });
    await expect(create).toBeInTheDocument();
  },
};

/** FLOW-1093: with no active project, the picker says so and keeps "+ פרויקט חדש". */
export const UnassignedPickerNoProjects: Story = {
  name: "Lines with no project, the picker with no projects",
  render: () => (
    <StoryRoute entry="/projects/unassigned" tabs>
      <ExampleBar />
      <ProjectUnassignedScreen sample={{ rows: UNASSIGNED_SAMPLE.rows, projects: [] }} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getAllByRole("button", { name: "שיוך" })[0] as HTMLElement);
    const sheet = await within(document.body).findByRole("dialog", { name: "לאיזה פרויקט?" });
    await expect(within(sheet).getByText("אין עדיין פרויקט לשייך אליו")).toBeInTheDocument();
    await expect(within(sheet).getByRole("button", { name: "+ פרויקט חדש" })).toBeInTheDocument();
  },
};

export const UnassignedEmpty: Story = {
  name: "Lines with no project, all assigned",
  render: () => (
    <StoryRoute entry="/projects/unassigned" tabs>
      <ExampleBar />
      <ProjectUnassignedScreen sample={{ rows: [], projects: UNASSIGNED_SAMPLE.projects }} />
    </StoryRoute>
  ),
};

export const UnassignedLong: Story = {
  name: "Lines with no project, long content",
  render: () => (
    <StoryRoute entry="/projects/unassigned" tabs>
      <ExampleBar />
      <ProjectUnassignedScreen sample={UNASSIGNED_LONG} />
    </StoryRoute>
  ),
};

export const UnassignedLoading: Story = {
  name: "Lines with no project, loading",
  render: () => (
    <StoryRoute entry="/projects/unassigned?preview=loading" tabs>
      <ProjectUnassignedScreen />
    </StoryRoute>
  ),
};

export const UnassignedFailed: Story = {
  name: "Lines with no project, the read failed",
  render: () => (
    <StoryRoute entry="/projects/unassigned?preview=error" tabs>
      <ProjectUnassignedScreen />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole("button", { name: /נסו שוב|ניסיון חוזר/u })).toBeInTheDocument();
  },
};
