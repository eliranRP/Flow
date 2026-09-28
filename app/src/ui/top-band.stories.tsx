import type { Meta, StoryObj } from "@storybook/react";
import { BigNumber } from "./big-number";
import { BandHero } from "./layout";
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
      <BandHero>
        <p className="t-title-2">שלום, אלירן</p>
        <h1 className="t-hero">
          <BigNumber agorot={-7_630_000n} />
        </h1>
      </BandHero>
    ),
  },
};

export const Preview: Story = {
  args: {
    preview: true,
    children: (
      <BandHero>
        <p className="t-title-2">שלום</p>
        <h1 className="ui-band-label t-label">כאן יופיע הרווח הנקי של העסק</h1>
      </BandHero>
    ),
  },
};

export const LongHebrew: Story = {
  args: {
    children: (
      <BandHero>
        <p className="t-title-2">{longHebrew}</p>
        <h1 className="t-hero">
          <BigNumber agorot={largeAgorot} />
        </h1>
      </BandHero>
    ),
  },
};
