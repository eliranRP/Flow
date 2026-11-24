import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Decorator } from "@storybook/react-vite";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { expect, waitFor, within } from "storybook/test";
import { Splash, SplashMark } from "./splash";
import { watchHomeReady } from "./splash-ready";

/**
 * FLOW-1277: the splash, frozen at points of its 2.7s timeline. The liquid (the icon's violet, both
 * themes) rises inside the tile, and where it covers the F, the F is white; it ends as the app icon.
 * The wordmark arrives under it at 2.3s. Every story runs in light and dark; the last one forces dark.
 * FLOW-1303: the live splash ends when Home's figures are drawn (see "Data ready early" and "Data late").
 */
const meta = {
  title: "Components/Splash",
  parameters: { flowRouter: false },
  decorators: [
    (Story) => (
      <div className="flex min-h-dvh items-center justify-center bg-bg">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The outline and the violet F, before the liquid. */
export const Start: Story = {
  render: () => <SplashMark at={0} />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("Flow")).toBeInTheDocument();
  },
};

/** Half way up: the F is white where the liquid has reached it. */
export const MidFill: Story = {
  render: () => <SplashMark at={1500} />,
};

/** The finished app icon and the wordmark. */
export const Done: Story = {
  render: () => <SplashMark at={2800} />,
};

function ForceDark({ children }: { children: ReactNode }) {
  // Dark for this story only; the theme comes back when it unmounts, so it never leaks into the next story.
  const before = document.documentElement.dataset.theme;
  document.documentElement.dataset.theme = "dark";
  useEffect(
    () => () => {
      if (before === undefined) delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = before;
    },
    [before],
  );
  return children;
}

const forceDark: Decorator = (Story) => (
  <ForceDark>
    <Story />
  </ForceDark>
);

/** On the dark page colour: the tile and the liquid stay the icon's violet; the wordmark takes the dark logo tone. */
export const Dark: Story = {
  decorators: [forceDark],
  render: () => <SplashMark at={1800} />,
};

/** Stories sit on a path that is not Home's, so the watch is told it is on Home and waits for the figures. */
const watchOnHome: typeof watchHomeReady = (onReady) => watchHomeReady(onReady, { path: () => "/" });

/**
 * The live splash over a page whose figures arrive `figuresAfterMs` after it shows (never, for null): the
 * same marker Home draws, in a hidden band, so the real watch decides. Once the splash is gone it says so.
 */
function LiveSplash({ figuresAfterMs }: { figuresAfterMs: number | null }) {
  const [figures, setFigures] = useState(false);
  const [gone, setGone] = useState(false);
  const onDone = useCallback(() => {
    setGone(true);
  }, []);
  useEffect(() => {
    if (figuresAfterMs == null) return;
    const timer = window.setTimeout(() => {
      setFigures(true);
    }, figuresAfterMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [figuresAfterMs]);
  return (
    <>
      <div className="ui-band-body" style={{ display: "none" }}>
        {figures ? <span className="ui-num">1,234</span> : null}
      </div>
      {gone ? <p className="t-body">The splash is gone</p> : <Splash onDone={onDone} watch={watchOnHome} />}
    </>
  );
}

/** Home's figures are drawn at 0.3s: the fill hurries to its end, the splash holds to 0.8s, then fades. */
export const DataReadyEarly: Story = {
  render: () => <LiveSplash figuresAfterMs={300} />,
  play: async ({ canvasElement }) => {
    const shown = performance.now();
    await expect(canvasElement.querySelector(".ui-splash")).not.toBeNull();
    await waitFor(() => expect(within(canvasElement).getByText("The splash is gone")).toBeInTheDocument(), { timeout: 2000 });
    await expect(performance.now() - shown).toBeGreaterThanOrEqual(800);
  },
};

/** The figures never come: the splash plays out, holds the finished icon, and leaves at the 3s failsafe. */
export const DataLateFailsafe: Story = {
  render: () => <LiveSplash figuresAfterMs={null} />,
  play: async ({ canvasElement }) => {
    const shown = performance.now();
    await waitFor(() => expect(within(canvasElement).getByText("The splash is gone")).toBeInTheDocument(), { timeout: 4000 });
    await expect(performance.now() - shown).toBeGreaterThanOrEqual(2900);
  },
};
