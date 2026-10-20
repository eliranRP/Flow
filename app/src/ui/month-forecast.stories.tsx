import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import type { ChartMonth } from "./month-chart-scale";
import { ForecastCard, MonthChart } from "./month-forecast";
import { padded } from "./story-support";

/**
 * Next month's forecast, the same on every screen (canvas note spec-fcwide): the dashed card and the
 * income and expense chart. Invented figures in the shape of the Profit and Projects boards; the dark pass
 * draws every story in dark too.
 */

const meta = {
  title: "Components/MonthForecast",
  decorators: [padded],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function months(rows: [string, string, number, number][]): ChartMonth[] {
  return rows.map(([key, label, income, expense]) => ({ key, label, incomeMinor: BigInt(income), expenseMinor: BigInt(expense) }));
}

const RENTAL = months([["2026-05", "מאי", 415_000, 180_000], ["2026-06", "יוני", 415_000, 187_000], ["2026-07", "יולי", 415_000, 170_000], ["2026-08", "אוג׳", 415_000, 176_000], ["2026-09", "ספט׳", 415_000, 174_000], ["2026-10", "אוק׳", 630_200, 250_640]]);
const RENTAL_NEXT: ChartMonth = { key: "2026-11", label: "נוב׳ · צפי", incomeMinor: 415_000n, expenseMinor: 186_500n };
const FLIP = months([["2026-07", "יולי", 0, 18_500_000], ["2026-08", "אוג׳", 0, 2_240_000], ["2026-09", "ספט׳", 0, 3_812_000], ["2026-10", "אוק׳", 0, 1_425_342]]);
const FLIP_NEXT: ChartMonth = { key: "2026-11", label: "נוב׳ · צפי", incomeMinor: 0n, expenseMinor: 1_200_000n };

/** A rental's profit page: the card opens the צפי page, the chart has six months and the forecast. */
export const Rental: Story = {
  render: () => (
    <>
      <ForecastCard monthName="נובמבר" currency="USD" incomeMinor={415_000n} expenseMinor={186_500n} incomeNote="2 שכירויות קבועות" expenseNote="מול $1,740 בספטמבר" netLabel="רווח צפוי" href="/projects/p/profit/next" />
      <MonthChart history={RENTAL} forecast={RENTAL_NEXT} sub="מאי עד אוקטובר וצפי" label="הכנסות והוצאות לפי חודש, מאי עד אוקטובר, וצפי נובמבר: הכנסות $4,150, הוצאות $1,865" />
    </>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: /^צפי נובמבר:/ })).toBeInTheDocument();
    await expect(canvas.getByRole("img", { name: /וצפי נובמבר/ })).toBeInTheDocument();
  },
};

/** A flip on the project page: no income ($0 in grey), the purchase month sets the scale, the profit link under the chart. */
export const Flip: Story = {
  render: () => (
    <>
      <ForecastCard monthName="נובמבר" currency="USD" incomeMinor={0n} expenseMinor={1_200_000n} incomeNote="אין הכנסה צפויה" expenseNote="מול $38,120 בספטמבר" netLabel="תזרים צפוי" href="/projects/p/profit/next" />
      <MonthChart history={FLIP} forecast={FLIP_NEXT} sub="מתחילת הפרויקט וצפי" label="הכנסות והוצאות לפי חודש, מתחילת הפרויקט, וצפי נובמבר: הכנסות $0, הוצאות $12,000" link={{ href: "/projects/p/profit", text: "רווח לפי חודש" }} />
    </>
  ),
};

/** Where there is no page to open (the company's card, PR B): a grey caption in the link's corner. */
export const CaptionNoLink: Story = {
  render: () => (
    <ForecastCard monthName="נובמבר" currency="USD" incomeMinor={3_160_000n} expenseMinor={2_795_000n} incomeNote="6 שכירויות ו־2 חשבוניות" expenseNote="מול $25,060 באוקטובר" netLabel="רווח צפוי" caption="7 פרויקטים וכללי" />
  ),
};

/**
 * Six figures in both columns: the two figures step down together from card size until both fit their
 * columns, so at 320 they never meet.
 */
export const SixFigures: Story = {
  render: () => (
    <ForecastCard monthName="נובמבר" currency="USD" incomeMinor={12_850_000n} expenseMinor={9_420_075n} incomeNote="תשלום מהלקוח" expenseNote="מול $88,310 באוקטובר" netLabel="תזרים צפוי" href="/projects/p/profit/next" />
  ),
  play: async ({ canvasElement }) => {
    // The two figures share one size, and each stays inside its own column.
    const sizes = [...canvasElement.querySelectorAll<HTMLElement>(".ui-fc-col > .ui-num")].map((figure) => getComputedStyle(figure).fontSize);
    await expect(new Set(sizes).size).toBe(1);
    for (const column of canvasElement.querySelectorAll<HTMLElement>(".ui-fc-col")) {
      const figure = column.querySelector(".ui-num");
      if (figure == null) throw new Error("figure missing");
      const box = column.getBoundingClientRect();
      const inner = figure.getBoundingClientRect();
      await expect(inner.left).toBeGreaterThanOrEqual(box.left - 0.5);
      await expect(inner.right).toBeLessThanOrEqual(box.right + 0.5);
    }
  },
};

/** The forecast could not be read: the chart keeps the months, with no forecast pair or swatch. */
export const ChartWithoutForecast: Story = {
  render: () => <MonthChart history={RENTAL} forecast={null} sub="מאי עד אוקטובר" label="הכנסות והוצאות לפי חודש, מאי עד אוקטובר" />,
};
