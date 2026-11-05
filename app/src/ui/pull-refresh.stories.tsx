import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import { Amount } from "./amount";
import { List, ListRow } from "./list-row";
import { PULL_REST_PX, PULL_SPOKES, PULL_THRESHOLD_PX, PullRefreshView, pullSpokes, type PullPhase, type PullTone } from "./pull-refresh";
import { ScreenHeader } from "./screen-header";
import { StoryRoute } from "./story-route";
import { useEffect, useState, type CSSProperties } from "react";
import { BandCompany, TopBand } from "./top-band";

/**
 * FLOW-1039, FLOW-1042 and FLOW-1043 (ld-07): a pull down from the top of a screen brings the screen
 * down, over a gap in the colour of its top, with the iOS activity indicator in the gap: its spokes
 * appear with the pull and turn while refreshing. Every story runs in light and dark.
 */
const meta = {
  title: "Components/Pull to refresh",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
type Play = NonNullable<Story["play"]>;

function Rows() {
  return (
    <List>
      <ListRow variant="button" title="חומרים" onClick={() => undefined} />
      <ListRow variant="button" title="קבלנים" onClick={() => undefined} />
      <ListRow variant="button" title="כלים וציוד" onClick={() => undefined} />
    </List>
  );
}

/** A screen that starts with the band, as Home does. `notch` is a notched iPhone's 59px status bar. */
function BandScreen({ phase, travel, tone = "band", notch = false }: { phase: PullPhase; travel: number; tone?: PullTone; notch?: boolean }) {
  return (
    <div style={notch ? ({ "--safe-top": "59px" } as CSSProperties) : undefined}>
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
    </div>
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

/** Mounts refreshing, then flips to returning, so the glide back runs as in the app. */
function ReturningScreen({ notch = false }: { notch?: boolean }) {
  const [phase, setPhase] = useState<PullPhase>("refreshing");
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setPhase("returning");
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, []);
  return <BandScreen phase={phase} travel={PULL_REST_PX} notch={notch} />;
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

const moved: Play = async ({ canvasElement }) => {
  const gap = canvasElement.querySelector(".ui-pull-gap");
  const band = canvasElement.querySelector(".ui-band");
  await expect(gap).not.toBeNull();
  await expect(band).not.toBeNull();
  if (gap == null || band == null) return;
  // The gap ends where the band starts, in the band's own colour.
  await expect(Math.abs(gap.getBoundingClientRect().bottom - band.getBoundingClientRect().top)).toBeLessThan(0.5);
  await expect(getComputedStyle(gap).backgroundColor).toBe(getComputedStyle(band).backgroundColor);
};

/** The spokes standing, by the share of the way to the threshold; no circle behind them. */
function spokes(count: number): Play {
  return async (context) => {
    await moved(context);
    const mark = context.canvasElement.querySelector(".ui-pull-refresh");
    const lines = Array.from(context.canvasElement.querySelectorAll(".ui-pull-spinner > line"));
    await expect(lines).toHaveLength(PULL_SPOKES);
    await expect(lines.filter((line) => line.getAttribute("opacity") === "1")).toHaveLength(count);
    if (mark == null) return;
    await expect(getComputedStyle(mark).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    await expect(Math.round(mark.getBoundingClientRect().width)).toBe(28);
    // The fade and the shrink are on a transition in every phase, so a caught return does not snap back.
    await expect(getComputedStyle(mark).transitionProperty).toContain("scale");
    await expect(getComputedStyle(mark).transitionProperty).toContain("opacity");
  };
}

/** The spinner lies inside the gap, below the status bar and above the screen's top. */
const inGap: Play = async (context) => {
  await moved(context);
  const gap = context.canvasElement.querySelector(".ui-pull-gap")?.getBoundingClientRect();
  const mark = context.canvasElement.querySelector(".ui-pull-refresh")?.getBoundingClientRect();
  const screenTop = context.canvasElement.querySelector(".ui-pull-screen")?.getBoundingClientRect().top;
  await expect(gap != null && mark != null && screenTop != null).toBe(true);
  if (gap == null || mark == null || screenTop == null) return;
  await expect(mark.top).toBeGreaterThanOrEqual(Math.max(gap.top, 59));
  await expect(mark.bottom).toBeLessThanOrEqual(gap.bottom);
  await expect(mark.bottom).toBeLessThanOrEqual(screenTop);
};

const quarter = PULL_THRESHOLD_PX / 4;
const half = PULL_THRESHOLD_PX / 2;

export const Pulling25At320: Story = { name: "Home, pulling 25%, 320", globals: at320, render: () => <BandScreen phase="pulling" travel={quarter} />, play: spokes(pullSpokes(quarter)) };
export const Pulling25At393: Story = { name: "Home, pulling 25%, 393", globals: at393, render: () => <BandScreen phase="pulling" travel={quarter} />, play: spokes(pullSpokes(quarter)) };
export const Pulling50At320: Story = { name: "Home, pulling 50%, 320", globals: at320, render: () => <BandScreen phase="pulling" travel={half} />, play: spokes(pullSpokes(half)) };
export const Pulling50At393: Story = { name: "Home, pulling 50%, 393", globals: at393, render: () => <BandScreen phase="pulling" travel={half} />, play: spokes(pullSpokes(half)) };
export const Notch100At320: Story = {
  name: "Home, notched iPhone, pulling 100%, 320",
  globals: at320,
  render: () => <BandScreen phase="pulling" travel={PULL_THRESHOLD_PX} notch />,
  play: async (context) => {
    await spokes(PULL_SPOKES)(context);
    await inGap(context);
  },
};
export const Notch100At393: Story = {
  name: "Home, notched iPhone, pulling 100%, 393",
  globals: at393,
  render: () => <BandScreen phase="pulling" travel={PULL_THRESHOLD_PX} notch />,
  play: async (context) => {
    await spokes(PULL_SPOKES)(context);
    await inGap(context);
  },
};
export const PastMonth: Story = { name: "Home, a past month's band, pulling 100%", globals: at393, render: () => <BandScreen phase="pulling" travel={PULL_THRESHOLD_PX} tone="band-past" />, play: moved };

const refreshing: Play = async (context) => {
  const live = within(context.canvasElement).getAllByRole("status").filter((node) => node.textContent === "מרענן");
  await expect(live).toHaveLength(1);
  const screenTop = context.canvasElement.querySelector(".ui-pull-screen")?.getBoundingClientRect().top;
  const gapTop = context.canvasElement.querySelector(".ui-pull-gap")?.getBoundingClientRect().bottom;
  // The screen rests at the gap's end.
  await expect(Math.round((gapTop ?? 0) - (screenTop ?? 0))).toBe(0);
};

export const NotchRefreshing320: Story = {
  name: "Home, notched iPhone, refreshing, 320",
  globals: at320,
  render: () => <BandScreen phase="refreshing" travel={PULL_REST_PX} notch />,
  play: async (context) => {
    await refreshing(context);
    await inGap(context);
  },
};
export const NotchRefreshing393: Story = {
  name: "Home, notched iPhone, refreshing, 393",
  globals: at393,
  render: () => <BandScreen phase="refreshing" travel={PULL_REST_PX} notch />,
  play: async (context) => {
    await refreshing(context);
    await inGap(context);
  },
};
export const Refreshing320: Story = {
  name: "Home, refreshing, 320",
  globals: at320,
  render: () => <BandScreen phase="refreshing" travel={PULL_REST_PX} />,
  play: async (context) => {
    await refreshing(context);
    await moved(context);
  },
};
export const Refreshing393: Story = {
  name: "Home, refreshing, 393",
  globals: at393,
  render: () => <BandScreen phase="refreshing" travel={PULL_REST_PX} />,
  play: async (context) => {
    await refreshing(context);
    await moved(context);
  },
};

/** The glide back ends with the screen at the top and the spinner gone from sight. */
const returned: Play = async ({ canvasElement }) => {
  const box = canvasElement.querySelector(".ui-pull-screen");
  const mark = canvasElement.querySelector(".ui-pull-refresh");
  await waitFor(async () => {
    await expect(box?.getAttribute("data-phase")).toBe("returning");
    await expect(box == null ? -1 : Number.parseFloat(getComputedStyle(box).top)).toBe(0);
    await expect(mark == null ? -1 : Number(getComputedStyle(mark).opacity)).toBe(0);
    await expect(mark == null ? "" : getComputedStyle(mark).scale).toBe("0.7");
  });
};

export const Returning320: Story = { name: "Home, notched iPhone, returning, 320", globals: at320, render: () => <ReturningScreen notch />, play: returned };
export const Returning393: Story = { name: "Home, returning, 393", globals: at393, render: () => <ReturningScreen />, play: returned };
export const PlainPulling: Story = { name: "A plain screen, pulling 50%, 393", globals: at393, render: () => <PlainScreen phase="pulling" travel={half} /> };
export const PlainRefreshing: Story = {
  name: "A plain screen, refreshing, 320",
  globals: at320,
  render: () => <PlainScreen phase="refreshing" travel={PULL_REST_PX} />,
  play: async (context) => {
    const live = within(context.canvasElement).getAllByRole("status").filter((node) => node.textContent === "מרענן");
    await expect(live).toHaveLength(1);
  },
};
