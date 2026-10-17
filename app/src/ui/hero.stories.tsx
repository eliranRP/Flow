import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Hero } from "./hero";
import { PeriodPicker } from "./period-picker";
import { TopBand } from "./top-band";

type HeroArgs = {
  label: string;
  agorot: string;
  explanation: string;
  pill: string;
};

function HeroView({ label, agorot, explanation, pill }: HeroArgs) {
  const [open, setOpen] = useState(false);
  const figure = agorot === "" ? undefined : BigInt(agorot);
  return (
    <>
      <TopBand
        wordmark={false}
        trailing={
          figure == null ? null : (
            <PeriodPicker
              pill={pill}
              open={open}
              onOpenChange={setOpen}
              options={[
                { label: "החודש", selected: pill === "החודש", onSelect: () => undefined },
                { label: "מתחילת השנה", selected: pill === "מתחילת השנה", onSelect: () => undefined },
                { label: "כל התקופה", selected: pill === "כל התקופה", onSelect: () => undefined },
              ]}
            />
          )
        }
      >
        <Hero label={label} agorot={figure} explanation={explanation || undefined} />
      </TopBand>
    </>
  );
}

const meta = {
  title: "Components/Hero",
  component: HeroView,
} satisfies Meta<typeof HeroView>;

export default meta;
type Story = StoryObj<typeof meta>;

const ytd = "הכנסות פחות הוצאות";

export const YearToDate: Story = {
  args: {
    label: "רווח מתחילת השנה",
    agorot: "3916400",
    explanation: ytd,
    pill: "מתחילת השנה",
  },
};

export const ThisMonth: Story = {
  args: {
    label: "רווח החודש",
    agorot: "1840000",
    explanation: "הכנסות פחות הוצאות",
    pill: "החודש",
  },
};

export const Loss: Story = {
  args: {
    label: "הפסד מתחילת השנה",
    agorot: "-7630000",
    explanation: ytd,
    pill: "מתחילת השנה",
  },
};

export const Empty: Story = {
  args: {
    label: "כאן יופיע הרווח של העסק",
    agorot: "",
    explanation: "",
    pill: "",
  },
};

/** FLOW-435: a project's history names the project on a small line above Home's label. */
export const WithKicker: Story = {
  args: { label: "תזרים מאז מרץ 2023", agorot: "4130000", explanation: "", pill: "" },
  render: (args) => (
    <TopBand wordmark={false}>
      <Hero kicker="Cedar Ave 410" label={args.label} figures={[{ agorot: BigInt(args.agorot), currency: "ILS" }]} />
    </TopBand>
  ),
};
