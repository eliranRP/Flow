import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { ProjectGroupScreen } from "./project-group-screen";
import { projectsGrouped } from "./project-groups-sample";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** FLOW-406 (proj-b-2): the group's page lists its projects, active first, back to פרויקטים. */
export const ProjectGroup: Story = {
  name: "Project group",
  render: () => (
    <StoryRoute entry="/projects/groups/g1" tabs>
      <ExampleBar />
      <ProjectGroupScreen sample={projectsGrouped} groupId="g1" />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "בניין לדוגמה" })).toBeInTheDocument();
    const names = canvas.getAllByRole("link").map((link) => link.textContent).filter((text) => text.includes("דירה"));
    await expect(names.findIndex((text) => text.includes("דירה 4"))).toBe(names.length - 1);
  },
};
export const ProjectGroupDark: Story = { ...ProjectGroup, name: "Project group, dark", globals: { theme: "dark" } };
export const ProjectGroup320: Story = {
  ...ProjectGroup,
  name: "Project group, 320",
  parameters: { viewport: { defaultViewport: "flow320" } },
};
export const ProjectGroupDark320: Story = {
  ...ProjectGroup,
  name: "Project group, dark, 320",
  globals: { theme: "dark" },
  parameters: { viewport: { defaultViewport: "flow320" } },
};

/** A link to a group that is gone says so and goes back to פרויקטים. */
export const ProjectGroupMissing: Story = {
  name: "Project group, not found",
  render: () => (
    <StoryRoute entry="/projects/groups/gone" tabs>
      <ExampleBar />
      <ProjectGroupScreen sample={projectsGrouped} groupId="gone" />
    </StoryRoute>
  ),
};
