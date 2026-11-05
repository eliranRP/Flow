import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { List, ListRow } from "./list-row";
import { PULL_THRESHOLD_PX, PullRefreshMark, type PullPhase } from "./pull-refresh";
import { ScreenHeader } from "./screen-header";
import { StoryRoute } from "./story-route";

/** FLOW-1039 (ld-07): the mark a pull down from the top of a screen shows. Every story runs in light and dark. */
const meta = {
  title: "Components/Pull to refresh",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Screen({ phase, travel }: { phase: PullPhase; travel: number }) {
  return (
    <StoryRoute entry="/settings/categories" tabs>
      <ScreenHeader backTo="/settings" kicker="הגדרות" title="קטגוריות" />
      <div className="ui-page-pad">
        <List>
          <ListRow variant="button" title="חומרים" onClick={() => undefined} />
          <ListRow variant="button" title="קבלנים" onClick={() => undefined} />
          <ListRow variant="button" title="כלים וציוד" onClick={() => undefined} />
        </List>
      </div>
      <PullRefreshMark phase={phase} travel={travel} />
    </StoryRoute>
  );
}

const at320 = { viewport: { value: "flow320", isRotated: false } };
const at393 = { viewport: { value: "flow393", isRotated: false } };

export const Idle: Story = {
  name: "Idle",
  globals: at393,
  render: () => <Screen phase="idle" travel={0} />,
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector(".ui-pull-refresh")).toBeNull();
    await expect(within(canvasElement).queryByText("מרענן")).toBeNull();
  },
};

export const Pulling320: Story = { name: "Pulling, 320", globals: at320, render: () => <Screen phase="pulling" travel={40} /> };
export const Pulling393: Story = { name: "Pulling, 393", globals: at393, render: () => <Screen phase="pulling" travel={40} /> };
export const Armed: Story = { name: "Armed: release refreshes", globals: at393, render: () => <Screen phase="pulling" travel={80} /> };

const refreshing: Story["play"] = async ({ canvasElement }) => {
  const live = within(canvasElement).getAllByRole("status").filter((node) => node.textContent === "מרענן");
  await expect(live).toHaveLength(1);
};

export const Refreshing320: Story = {
  name: "Refreshing, 320",
  globals: at320,
  render: () => <Screen phase="refreshing" travel={PULL_THRESHOLD_PX} />,
  play: refreshing,
};
export const Refreshing393: Story = {
  name: "Refreshing, 393",
  globals: at393,
  render: () => <Screen phase="refreshing" travel={PULL_THRESHOLD_PX} />,
  play: refreshing,
};
