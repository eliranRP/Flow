import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { FlowLines, Hero } from "./hero";
import { PeriodPicker } from "./period-picker";
import { TopBand } from "./top-band";

type HeroArgs = {
  label: string;
  agorot: string;
  explanation: string;
  income: string;
  expense: string;
  pill: string;
};

function HeroView({ label, agorot, explanation, income, expense, pill }: HeroArgs) {
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
      {income !== "" && expense !== "" ? <FlowLines income={BigInt(income)} expense={BigInt(expense)} /> : null}
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
    income: "47200000",
    expense: "43283600",
    pill: "מתחילת השנה",
  },
};

export const ThisMonth: Story = {
  args: {
    label: "רווח החודש",
    agorot: "1840000",
    explanation: "הכנסות פחות הוצאות",
    income: "8200000",
    expense: "6360000",
    pill: "החודש",
  },
};

export const Loss: Story = {
  args: {
    label: "הפסד מתחילת השנה",
    agorot: "-7630000",
    explanation: ytd,
    income: "21000000",
    expense: "28630000",
    pill: "מתחילת השנה",
  },
};

export const Empty: Story = {
  args: {
    label: "כאן יופיע הרווח של העסק",
    agorot: "",
    explanation: "",
    income: "",
    expense: "",
    pill: "",
  },
};

/** FLOW-355: Home's period pill between the label and the figure, with no explanation line. */
function PillHero({ label, agorot, pill }: { label: string; agorot: string; pill: string }) {
  const [open, setOpen] = useState(false);
  return (
    <TopBand wordmark={false}>
      <Hero
        label={label}
        agorot={BigInt(agorot)}
        pill={<PeriodPicker pill={pill} name={`${pill} – בחירת תקופה`} open={open} onOpenChange={setOpen} options={[{ label: pill, selected: true, onSelect: () => undefined }]} />}
      />
    </TopBand>
  );
}

export const WithPill: Story = {
  args: { label: "רווח ב־3 חודשים", agorot: "20000000", explanation: "", income: "", expense: "", pill: "אוגוסט – אוקטובר 2026" },
  render: (args) => <PillHero label={args.label} agorot={args.agorot} pill={args.pill} />,
};
export const WithPillDark: Story = { ...WithPill, globals: { theme: "dark" } };
export const WithPill320: Story = { ...WithPill, parameters: { viewport: { defaultViewport: "flow320" } } };
