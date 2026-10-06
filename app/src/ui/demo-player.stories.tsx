import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "@storybook/test";
import { DemoPlayer } from "./demo-player";
import { forceReducedMotion } from "./reduced-motion";
import { longHebrew } from "./story-support";
import "./demo-player.stories.css";

function SampleScene({ title }: { title: string }) {
  return (
    <div className="ui-demo-scene">
      <div className="ui-demo-card ui-demo-slide">
        <p className="t-title-3">{title}</p>
        <p className="t-body">
          <bdi dir="ltr">₪1,200</bdi>
        </p>
      </div>
    </div>
  );
}

const meta = {
  title: "Components/DemoPlayer",
  component: DemoPlayer,
  parameters: {
    a11y: {
      config: {
        rules: [
          { id: "heading-order", enabled: false },
          { id: "page-has-heading-one", enabled: false },
        ],
      },
    },
  },
  args: {
    alt: "הדגמה: מחברים את SUMIT, והתנועות נכנסות ללשונית לאישור.",
    durationMs: 4000,
    children: <SampleScene title="דוגמה בע״מ" />,
  },
} satisfies Meta<typeof DemoPlayer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LastFrame: Story = {
  decorators: [forceReducedMotion],
};

export const Playing: Story = {
  args: { durationMs: 1200 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const root = canvasElement.querySelector(".ui-demo");
    await waitFor(() => expect(canvas.getByRole("button", { name: "שוב" })).toBeVisible(), { timeout: 3000 });
    await expect(root).toHaveAttribute("data-demo-state", "settled");
    await userEvent.click(canvas.getByRole("button", { name: "שוב" }));
    await expect(root).toHaveAttribute("data-demo-state", "playing");
    await expect(canvas.queryByRole("button", { name: "שוב" })).toBeNull();
    await expect(canvasElement.querySelector(".ui-demo-replay")).toHaveFocus();
    await waitFor(() => expect(root).toHaveAttribute("data-demo-state", "settled"), { timeout: 3000 });
  },
};

export const LongHebrew: Story = {
  decorators: [forceReducedMotion],
  args: {
    alt: longHebrew,
    children: <SampleScene title={longHebrew} />,
  },
};
