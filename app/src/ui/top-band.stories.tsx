import type { Meta, StoryObj } from "@storybook/react";
import type { ReactNode } from "react";
import { BigNumber } from "./big-number";
import { BandHero } from "./layout";
import { longHebrew, largeAgorot } from "./story-support";
import { TopBand } from "./top-band";

type BandArgs = {
  preview?: boolean;
  heading: string;
  amount?: string;
  label?: string;
};

function BandView({ preview, heading, amount, label }: BandArgs) {
  let body: ReactNode;
  if (label) {
    body = <h1 className="ui-band-label t-label">{label}</h1>;
  } else {
    body = (
      <h1>
        <BigNumber agorot={BigInt(amount ?? "0")} size="hero" />
      </h1>
    );
  }
  return (
    <TopBand preview={preview}>
      <BandHero>
        <p className="t-title-2">{heading}</p>
        {body}
      </BandHero>
    </TopBand>
  );
}

const meta = {
  title: "Components/TopBand",
  component: BandView,
} satisfies Meta<typeof BandView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { heading: "רווח נקי מתחילת השנה", amount: "3916400" },
};

export const Preview: Story = {
  args: { preview: true, heading: "מצב תצוגה", label: "כאן יופיע הרווח הנקי של העסק" },
};

export const LongHebrew: Story = {
  args: { heading: longHebrew, amount: String(largeAgorot) },
};
