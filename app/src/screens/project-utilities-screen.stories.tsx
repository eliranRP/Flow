import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { ProjectUtilitiesScreen } from "./project-utilities-screen";
import { GEFEN, utilityPayersSample, utilityRefundsSample, utilityScheduleSample } from "./utility-refunds-sample";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/ProjectUtilities",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const sample = () => ({
  projectId: GEFEN,
  name: "דירת הגפן 3",
  utilities: utilityPayersSample(),
  bills: utilityRefundsSample().filter((bill) => bill.project_id === GEFEN),
  schedule: utilityScheduleSample(),
});

/** FLOW-1135 (V3-Project-Utilities): each utility, its usual amount and who pays; two bills not refunded. */
export const ProjectUtilities: Story = {
  render: () => (
    <StoryRoute entry={`/projects/${GEFEN}/utilities`} tabs>
      <ExampleBar />
      <ProjectUtilitiesScreen sample={sample()} />
    </StoryRoute>
  ),
};

/** A viewer sees who pays each utility and changes nothing. */
export const ProjectUtilitiesViewer: Story = {
  name: "ProjectUtilities, viewer",
  render: () => (
    <StoryRoute entry={`/projects/${GEFEN}/utilities`} tabs viewer>
      <ExampleBar />
      <ProjectUtilitiesScreen sample={sample()} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole("button", { name: /הוספת ספק/ })).toBeNull();
  },
};

/** No utility found yet: what Flow looks for, and הוספת ספק. */
export const ProjectUtilitiesEmpty: Story = {
  name: "ProjectUtilities, none yet",
  render: () => (
    <StoryRoute entry={`/projects/${GEFEN}/utilities`} tabs>
      <ExampleBar />
      <ProjectUtilitiesScreen sample={{ ...sample(), utilities: [], bills: [] }} />
    </StoryRoute>
  ),
};

/** Long supplier names end in an ellipsis; the שוכר / חברה switch keeps its size. */
export const ProjectUtilitiesLong: Story = {
  name: "ProjectUtilities, long content",
  render: () => (
    <StoryRoute entry={`/projects/${GEFEN}/utilities`} tabs>
      <ExampleBar />
      <ProjectUtilitiesScreen sample={{ ...sample(), utilities: utilityPayersSample().map((row) => ({ ...row, supplier_name: `${row.supplier_name} Regional Utilities Authority` })) }} />
    </StoryRoute>
  ),
};

export const ProjectUtilitiesLoading: Story = {
  name: "ProjectUtilities, loading",
  render: () => (
    <StoryRoute entry={`/projects/${GEFEN}/utilities?preview=loading`} tabs>
      <ExampleBar />
      <ProjectUtilitiesScreen />
    </StoryRoute>
  ),
};

export const ProjectUtilitiesError: Story = {
  name: "ProjectUtilities, failed",
  render: () => (
    <StoryRoute entry={`/projects/${GEFEN}/utilities?preview=error`} tabs>
      <ExampleBar />
      <ProjectUtilitiesScreen />
    </StoryRoute>
  ),
};

/** חברה closes the utility's open bills and the toast offers ביטול. */
export const ProjectUtilitiesCompany: Story = {
  name: "ProjectUtilities, company pays",
  render: () => (
    <StoryRoute entry={`/projects/${GEFEN}/utilities`} tabs>
      <ExampleBar />
      <ProjectUtilitiesScreen sample={sample()} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const group = within(canvasElement).getByRole("radiogroup", { name: "מי משלם: Power Co" });
    await userEvent.click(within(group).getByRole("radio", { name: "חברה" }));
    await expect(await within(document.body).findByText("Power Co · החברה משלמת · 1 נסגרו")).toBeInTheDocument();
  },
};

/** הוספת ספק lists the property's recurring expenses that are not a utility yet. */
export const ProjectUtilitiesAdd: Story = {
  name: "ProjectUtilities, add a supplier",
  render: () => (
    <StoryRoute entry={`/projects/${GEFEN}/utilities`} tabs>
      <ExampleBar />
      <ProjectUtilitiesScreen sample={sample()} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /הוספת ספק/ }));
    await expect(await within(document.body).findByRole("button", { name: /Trash Co/ })).toBeInTheDocument();
  },
};
