import type { Meta, StoryObj } from "@storybook/react";
import { JUNIPER_PROFIT } from "../dev/project-profit-sample";
import { ProjectProfitScreen } from "./project-profit-screen";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const sample = JUNIPER_PROFIT;

function ProfitRoute({ entry }: { entry: string }) {
  return (
    <StoryRoute entry={entry} tabs>
      <ExampleBar />
      <ProjectProfitScreen sample={sample} />
    </StoryRoute>
  );
}

export const ProjectProfit: Story = {
  name: "Project profit, summary and months",
  render: () => <ProfitRoute entry="/projects/juniper-ct/profit" />,
};

/** Reached from the company profit page: Back names "רווח". */
export const ProjectProfitFromCompany: Story = {
  name: "Project profit, opened from company profit",
  render: () => <ProfitRoute entry="/projects/juniper-ct/profit?from=profit" />,
};
