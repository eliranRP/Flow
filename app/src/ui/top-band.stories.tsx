import type { Meta, StoryObj } from "@storybook/react";
import { BigNumber } from "./big-number";
import { longHebrew, largeAgorot } from "./story-support";
import { TopBand } from "./top-band";

const meta = {
  title: "Components/TopBand",
  component: TopBand,
} satisfies Meta<typeof TopBand>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: (
      <div className="band-hero">
        <p className="t-title-2">שלום, אלירן</p>
        <h1 className="t-hero">
          <BigNumber agorot={-7_630_000n} />
        </h1>
      </div>
    ),
  },
};

export const Preview: Story = {
  args: {
    preview: true,
    children: (
      <div className="band-hero">
        <p className="t-title-2">שלום</p>
        <h1 className="band-label t-label">כאן יופיע הרווח הנקי של העסק</h1>
      </div>
    ),
  },
};

export const LongHebrew: Story = {
  args: {
    children: (
      <div className="band-hero">
        <p className="t-title-2">{longHebrew}</p>
        <h1 className="t-hero">
          <BigNumber agorot={largeAgorot} />
        </h1>
      </div>
    ),
  },
};
