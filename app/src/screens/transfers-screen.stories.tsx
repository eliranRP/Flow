import type { Meta, StoryObj } from "@storybook/react-vite";
import { TransfersScreen } from "./transfers-screen";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";
import { transfersSample } from "../dev/transfers-sample";

const meta = {
  title: "Screens/Transfers",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** FLOW-941: two suggested transfers between two Mercury connections, each with its question and answers. */
export const TransfersList: Story = {
  render: () => (
    <StoryRoute entry="/transfers" tabs>
      <ExampleBar />
      <TransfersScreen sample={transfersSample()} />
    </StoryRoute>
  ),
};

/** Nothing left to review. */
export const TransfersEmpty: Story = {
  render: () => (
    <StoryRoute entry="/transfers" tabs>
      <ExampleBar />
      <TransfersScreen sample={[]} />
    </StoryRoute>
  ),
};
