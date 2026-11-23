import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Decorator } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { SplashMark } from "./splash";

/**
 * FLOW-1277: the splash, frozen at points of its 2.7s timeline. The liquid (the icon's violet, both
 * themes) rises inside the tile, and where it covers the F, the F is white; it ends as the app icon.
 * The wordmark arrives under it at 2.3s. Every story runs in light and dark; the last one forces dark.
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

const forceDark: Decorator = (Story) => {
  document.documentElement.dataset.theme = "dark";
  return <Story />;
};

/** On the dark page colour: the tile and the liquid stay the icon's violet; the wordmark takes the dark logo tone. */
export const Dark: Story = {
  decorators: [forceDark],
  render: () => <SplashMark at={1800} />,
};
