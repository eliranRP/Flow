import type { Meta, StoryObj } from "@storybook/react";
import { EdgeBackMark } from "./edge-back";
import { List, ListRow } from "./list-row";
import { ScreenHeader } from "./screen-header";
import { StoryRoute } from "./story-route";

/** FLOW-332: the mark a swipe from the start (right) edge shows on a pushed screen. */
const meta = {
  title: "Components/Edge swipe back",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Pushed({ pull, armed }: { pull: number; armed: boolean }) {
  return (
    <StoryRoute entry="/settings/categories">
      <ScreenHeader backTo="/settings" kicker="הגדרות" title="קטגוריות" />
      <div className="ui-page-pad">
        <List>
          <ListRow variant="button" title="חומרים" onClick={() => undefined} />
          <ListRow variant="button" title="קבלנים" onClick={() => undefined} />
          <ListRow variant="button" title="כלים וציוד" onClick={() => undefined} />
        </List>
      </div>
      <EdgeBackMark pull={pull} y={520} armed={armed} />
    </StoryRoute>
  );
}

const dark = { globals: { theme: "dark" as const } };

export const Pulling: Story = { name: "Pulling", render: () => <Pushed pull={60} armed={false} /> };
export const PullingDark: Story = { ...Pulling, name: "Pulling, dark", ...dark };
export const Armed: Story = { name: "Armed: release goes back", render: () => <Pushed pull={140} armed /> };
export const ArmedDark: Story = { ...Armed, name: "Armed, dark", ...dark };
