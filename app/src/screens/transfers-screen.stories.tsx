import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
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

/** FLOW-941, FLOW-1049: two suggested transfers, each a pair card with its two answers. */
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

/** FLOW-1049: long account names end in an ellipsis; the two answers keep their halves. */
export const TransfersLong: Story = {
  name: "Transfers, long content",
  render: () => (
    <StoryRoute entry="/transfers" tabs>
      <ExampleBar />
      <TransfersScreen
        sample={Array.from({ length: 5 }, (_, k) => transfersSample().map((match) => ({
          ...match,
          out: { ...match.out, transaction_id: `${match.out.transaction_id}-${String(k)}`, account_name: "Operations account for the renovation projects" },
          in: { ...match.in, transaction_id: `${match.in.transaction_id}-${String(k)}` },
        }))).flat()}
      />
    </StoryRoute>
  ),
};

/** FLOW-1049: the read is on its way. */
export const TransfersLoading: Story = {
  name: "Transfers, loading",
  render: () => (
    <StoryRoute entry="/transfers?preview=loading" tabs>
      <ExampleBar />
      <TransfersScreen />
    </StoryRoute>
  ),
};

/** FLOW-1049: the read failed: what happened, with נסו שוב. */
export const TransfersError: Story = {
  name: "Transfers, failed",
  render: () => (
    <StoryRoute entry="/transfers?preview=error" tabs>
      <ExampleBar />
      <TransfersScreen />
    </StoryRoute>
  ),
};

/** FLOW-1049: כן, העברה takes the card away and the toast offers ביטול. */
export const TransfersAnswered: Story = {
  name: "Transfers, answered",
  render: () => (
    <StoryRoute entry="/transfers" tabs>
      <ExampleBar />
      <TransfersScreen sample={transfersSample()} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const [yes] = within(canvasElement).getAllByRole("button", { name: "כן, העברה" });
    await userEvent.click(yes as HTMLElement);
    await expect(await within(document.body).findByText("סומן כהעברה")).toBeInTheDocument();
  },
};
