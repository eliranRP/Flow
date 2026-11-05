import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { Amount } from "./amount";
import { List, ListRow } from "./list-row";
import { PULL_THRESHOLD_PX, PullRefreshView, type PullPhase, type PullTone } from "./pull-refresh";
import { ScreenHeader } from "./screen-header";
import { StoryRoute } from "./story-route";
import { BandCompany, TopBand } from "./top-band";

/**
 * FLOW-1039 and FLOW-1042 (ld-07): a pull down from the top of a screen brings the screen down, over a
 * gap in the colour of its top, with the mark in the gap. Every story runs in light and dark.
 */
const meta = {
  title: "Components/Pull to refresh",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Rows() {
  return (
    <List>
      <ListRow variant="button" title="חומרים" onClick={() => undefined} />
      <ListRow variant="button" title="קבלנים" onClick={() => undefined} />
      <ListRow variant="button" title="כלים וציוד" onClick={() => undefined} />
    </List>
  );
}

/** A screen that starts with the band, as Home does. */
function BandScreen({ phase, travel, tone = "band" }: { phase: PullPhase; travel: number; tone?: PullTone }) {
  return (
    <PullRefreshView phase={phase} travel={travel} tone={tone}>
      <StoryRoute entry="/" tabs>
        <TopBand
          tone={tone === "band-past" ? "past" : "current"}
          wordmark={false}
          leading={<BandCompany name="חברה לדוגמה" onOpen={() => undefined} />}
          hero={
            <>
              <p className="t-name">תזרים · עד היום</p>
              <h1>
                <Amount agorot={3916400n} size="hero" />
              </h1>
            </>
          }
        />
        <div className="ui-page-pad">
          <Rows />
        </div>
      </StoryRoute>
    </PullRefreshView>
  );
}

/** A plain screen: the gap takes the page colour. */
function PlainScreen({ phase, travel }: { phase: PullPhase; travel: number }) {
  return (
    <PullRefreshView phase={phase} travel={travel}>
      <StoryRoute entry="/settings/categories" tabs>
        <ScreenHeader backTo="/settings" kicker="הגדרות" title="קטגוריות" />
        <div className="ui-page-pad">
          <Rows />
        </div>
      </StoryRoute>
    </PullRefreshView>
  );
}

const at320 = { viewport: { value: "flow320", isRotated: false } };
const at393 = { viewport: { value: "flow393", isRotated: false } };

export const Idle: Story = {
  name: "Idle",
  globals: at393,
  render: () => <BandScreen phase="idle" travel={0} />,
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector(".ui-pull-refresh")).toBeNull();
    await expect(canvasElement.querySelector(".ui-pull-gap")).toBeNull();
    await expect(canvasElement.querySelector(".ui-pull-screen")?.hasAttribute("data-phase")).toBe(false);
    await expect(within(canvasElement).queryByText("מרענן")).toBeNull();
  },
};

const moved: Story["play"] = async ({ canvasElement }) => {
  const gap = canvasElement.querySelector(".ui-pull-gap");
  const band = canvasElement.querySelector(".ui-band");
  await expect(gap).not.toBeNull();
  await expect(band).not.toBeNull();
  if (gap == null || band == null) return;
  // The gap ends where the band starts, in the band's own colour.
  await expect(Math.round(gap.getBoundingClientRect().bottom)).toBe(Math.round(band.getBoundingClientRect().top));
  await expect(getComputedStyle(gap).backgroundColor).toBe(getComputedStyle(band).backgroundColor);
};

export const Pulling320: Story = { name: "Home, pulling, 320", globals: at320, render: () => <BandScreen phase="pulling" travel={48} />, play: moved };
export const Pulling393: Story = { name: "Home, pulling, 393", globals: at393, render: () => <BandScreen phase="pulling" travel={48} />, play: moved };
export const Armed: Story = { name: "Home, armed: release refreshes", globals: at393, render: () => <BandScreen phase="pulling" travel={80} />, play: moved };
export const PastMonth: Story = { name: "Home, a past month's band", globals: at393, render: () => <BandScreen phase="pulling" travel={64} tone="band-past" />, play: moved };

const refreshing: Story["play"] = async (context) => {
  const live = within(context.canvasElement).getAllByRole("status").filter((node) => node.textContent === "מרענן");
  await expect(live).toHaveLength(1);
};

export const Refreshing320: Story = {
  name: "Home, refreshing, 320",
  globals: at320,
  render: () => <BandScreen phase="refreshing" travel={PULL_THRESHOLD_PX} />,
  play: async (context) => {
    await refreshing(context);
    await moved(context);
  },
};
export const Refreshing393: Story = {
  name: "Home, refreshing, 393",
  globals: at393,
  render: () => <BandScreen phase="refreshing" travel={PULL_THRESHOLD_PX} />,
  play: async (context) => {
    await refreshing(context);
    await moved(context);
  },
};
export const PlainPulling: Story = { name: "A plain screen, pulling, 393", globals: at393, render: () => <PlainScreen phase="pulling" travel={48} /> };
export const PlainRefreshing: Story = {
  name: "A plain screen, refreshing, 320",
  globals: at320,
  render: () => <PlainScreen phase="refreshing" travel={PULL_THRESHOLD_PX} />,
  play: refreshing,
};
