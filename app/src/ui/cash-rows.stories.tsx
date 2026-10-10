import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { CashRows, type CashRow } from "./cash-rows";
import { at320, dark } from "./screen-stories-support";
import { StoryRoute } from "./story-route";

/** FLOW-413 + FLOW-418 + FLOW-417: the cash view's rows. Invented figures. Rows hold bigints, so stories render them rather than pass args. */

const meta = {
  title: "Components/CashRows",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const ils = (minor: bigint) => [{ currency: "ILS", minor }];

const rows: CashRow[] = [
  { id: "in", label: "נכנס", tone: "in", amounts: ils(1_800_000n), href: "/cash/2026-10/in/ILS", name: "נכנס באוקטובר ₪18,000 – פירוט" },
  { id: "out", label: "יצא", tone: "out", amounts: ils(1_480_000n), href: "/cash/2026-10/out/ILS", name: "יצא באוקטובר ₪14,800 – פירוט" },
  { id: "profit", label: "רווח החודש", tone: "quiet", amounts: ils(560_000n), href: "/profit", name: "רווח באוקטובר ₪5,600" },
  {
    id: "kept",
    label: "לא נספר ברווח",
    hint: "שיפוץ והשבחה, השקעת בעלים",
    tone: "aside",
    amounts: ils(-240_000n),
    href: "/cash/2026-10/kept/ILS",
    name: "לא נספר ברווח באוקטובר −₪2,400 – פירוט",
  },
];

export const Month: Story = {
  name: "A month: in, out, profit and what profit leaves out",
  render: () => (
    <StoryRoute entry="/">
      <CashRows rows={rows} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const kept = canvas.getByRole("link", { name: /^לא נספר ברווח/ });
    await expect(within(kept).getByText("שיפוץ והשבחה, השקעת בעלים")).toBeInTheDocument();
  },
};
export const MonthDark: Story = { ...Month, name: "A month, dark", ...dark };
export const Month320: Story = { ...Month, name: "A month, 320", ...at320 };

const months: CashRow[] = [
  { id: "09", label: "ספטמבר", tone: "net", amounts: ils(-115_000n), href: "/cash/2026-09", name: "תזרים ספטמבר −₪1,150" },
  { id: "08", label: "אוגוסט", tone: "net", amounts: ils(240_000n), href: "/cash/2026-08", name: "תזרים אוגוסט ₪2,400" },
];

const years: CashRow[] = [
  { id: "2026", label: "2026", hint: "10 חודשים", tone: "net", amounts: ils(890_000n), href: "/cash/year/2026", name: "תזרים 2026 ₪8,900" },
  { id: "2025", label: "2025", tone: "net", amounts: ils(1_960_000n), href: "/cash/year/2025", name: "תזרים 2025 ₪19,600" },
  { id: "2024", label: "2024", tone: "net", amounts: ils(-420_000n), href: "/cash/year/2024", name: "תזרים 2024 −₪4,200" },
  { id: "2023", label: "2023", hint: "מאז מרץ", tone: "net", amounts: ils(1_700_000n), href: "/cash/year/2023", name: "תזרים 2023 ₪17,000" },
];

const figures: CashRow[] = [
  { id: "in", label: "נכנס", tone: "in", amounts: ils(18_400_000n), name: "נכנס ב2025 ₪184,000" },
  { id: "out", label: "יצא", tone: "out", amounts: ils(16_440_000n), name: "יצא ב2025 ₪164,400" },
];

export const Months: Story = {
  name: "Month rows",
  render: () => (
    <StoryRoute entry="/">
      <CashRows rows={months} months />
    </StoryRoute>
  ),
};

/** FLOW-417: year rows carry a quiet line: this year's month count, the first year's first month. */
export const YearsWithHints: Story = {
  name: "Year rows with hints",
  render: () => (
    <StoryRoute entry="/">
      <CashRows rows={years} months />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: "תזרים 2026 ₪8,900" })).toBeInTheDocument();
    await expect(canvas.getByText("מאז מרץ")).toBeInTheDocument();
  },
};

/** FLOW-417: a year's נכנס and יצא are figures only: no link, no chevron. */
export const FiguresOnly: Story = {
  name: "Figures only (a year's נכנס and יצא)",
  render: () => (
    <StoryRoute entry="/">
      <CashRows rows={figures} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryAllByRole("link")).toHaveLength(0);
  },
};
