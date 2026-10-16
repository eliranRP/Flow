import type { Meta, StoryObj } from "@storybook/react";
import { expect, waitFor } from "@storybook/test";
import type { ReactNode } from "react";
import { Amount } from "./amount";
import { BandHero } from "./layout";
import { longHebrew, largeAgorot } from "./story-support";
import { BandCompany, TopBand } from "./top-band";

type BandArgs = {
  preview?: boolean;
  heading: string;
  amount?: string;
  label?: string;
  /** FLOW-364: the company's name at the start of the band row (Home). */
  company?: string;
  /** FLOW-364: a past month's darker band. */
  past?: boolean;
};

function BandView({ preview, heading, amount, label, company, past }: BandArgs) {
  let body: ReactNode;
  if (label) {
    body = <h1 className="ui-band-label t-label">{label}</h1>;
  } else {
    body = (
      <h1>
        <Amount agorot={BigInt(amount ?? "0")} size="hero" />
      </h1>
    );
  }
  return (
    <TopBand
      preview={preview}
      tone={past ? "past" : "current"}
      wordmark={company == null}
      leading={company == null ? undefined : <BandCompany name={company} onOpen={() => undefined} />}
    >
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
  args: { heading: "רווח מתחילת השנה", amount: "3916400" },
};

export const Preview: Story = {
  args: { preview: true, heading: "מצב תצוגה", label: "כאן יופיע הרווח של העסק" },
};

export const LongHebrew: Story = {
  args: { heading: longHebrew, amount: String(largeAgorot) },
};

/** FLOW-364: Home's band with the company's name at the start and the figures under it. */
export const Company: Story = {
  args: { company: "חברה לדוגמה", heading: "תזרים · עד היום", amount: "3916400" },
};

/** FLOW-364: a past month's band, in the darker colour. */
export const Past: Story = {
  args: { company: "חברה לדוגמה", past: true, heading: "תזרים · חודש סגור", amount: "1204500" },
};

/** The project name on the band is `band-title` 32 (decision 0120), above the 36 profit. */
function ProjectBand({ name }: { name: string }) {
  return (
    <TopBand>
      <BandHero>
        <p className="t-band-title">{name}</p>
        <p className="ui-band-label t-label">רווח</p>
        <p className="t-display">
          <Amount agorot={2_940_000n} />
        </p>
      </BandHero>
    </TopBand>
  );
}

export const ProjectName: Story = {
  args: { heading: "וילה לדוגמה" },
  render: ({ heading }) => <ProjectBand name={heading} />,
};
export const ProjectNameLong: Story = {
  args: { heading: longHebrew },
  render: ({ heading }) => <ProjectBand name={heading} />,
};
/**
 * FLOW-363 (3a): the band's figures fade as the page scrolls, full at the top and gone by 220px.
 * The play function scrolls the page 140px, so the figure reads about 0.5.
 */
export const ScrollFade: Story = {
  args: { heading: "רווח מתחילת השנה" },
  render: ({ heading }) => (
    <div>
      <TopBand>
        <BandHero>
          <p className="t-title-2">{heading}</p>
          <p className="ui-band-fade t-display">
            <Amount agorot={3_916_400n} />
          </p>
        </BandHero>
      </TopBand>
      {Array.from({ length: 40 }, (_, index) => (
        <p key={index} className="ui-page-pad t-body" style={{ paddingBlock: 12 }}>
          {`שורה לדוגמה ${String(index + 1)}`}
        </p>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const doc = canvasElement.ownerDocument;
    doc.defaultView?.scrollTo(0, 140);
    await waitFor(() => expect(doc.querySelector<HTMLElement>(".ui-band")?.style.getPropertyValue("--band-fade")).toBe("0.5"));
  },
};
