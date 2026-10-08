import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import { allTime, customRange, presetPeriod, stepPeriod, type PeriodChoice, type PeriodScope } from "../period";
import { BandHero } from "./layout";
import { PeriodBar } from "./period-bar";
import { TopBand } from "./top-band";

type DemoArgs = {
  start: "months3" | "month-back" | "year" | "all" | "custom";
  tone?: "band" | "page";
  scope?: PeriodScope;
};

function startPeriod(start: DemoArgs["start"]): PeriodChoice {
  switch (start) {
    case "months3":
      return presetPeriod("months3");
    case "month-back":
      return stepPeriod(presetPeriod("month"), -1) ?? presetPeriod("month");
    case "year":
      return presetPeriod("year");
    case "all":
      return allTime();
    case "custom":
      return customRange("2026-03-02", "2026-05-20");
    default:
      return presetPeriod("months3");
  }
}

/** The bar keeps its own period here; on Home it is the books period, on a project its own. */
function Demo({ start, tone = "band", scope = "company" }: DemoArgs) {
  const [period, setPeriod] = useState(() => startPeriod(start));
  if (tone === "page") {
    return (
      <div className="ui-page">
        <PeriodBar period={period} onChange={setPeriod} tone="page" scope={scope} />
      </div>
    );
  }
  if (scope === "project") {
    return (
      <TopBand wordmark={false}>
        <BandHero>
          <p className="t-band-title">שיפוץ דירה לדוגמה</p>
          <PeriodBar period={period} onChange={setPeriod} scope="project" />
        </BandHero>
      </TopBand>
    );
  }
  return <TopBand wordmark={false} trailing={<PeriodBar period={period} onChange={setPeriod} />} />;
}

const meta = {
  title: "Components/PeriodBar",
  component: Demo,
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

const at320 = { parameters: { viewport: { defaultViewport: "flow320" } } };
const dark = { globals: { theme: "dark" } };

/** Home's default: the last 3 months to date. The later arrow is off at the current window. */
export const ThreeMonths: Story = {
  args: { start: "months3" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const later = canvas.getByRole("button", { name: "3 חודשים הבאים" });
    await expect(later).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(canvas.getByRole("button", { name: "3 חודשים קודמים" }));
    await expect(later).not.toHaveAttribute("aria-disabled");
    await expect(canvas.getByRole("radio", { name: "3 חודשים" })).toHaveAttribute("aria-checked", "true");
    // The start-side arrow points right and the end-side one points left: both point outward.
    const svgs = canvasElement.querySelectorAll(".ui-pbar-arrow svg");
    await expect(svgs[0]?.getAttribute("data-points")).toBe("right");
    await expect(svgs[1]?.getAttribute("data-points")).toBe("left");
    const [first, second] = [...canvasElement.querySelectorAll(".ui-pbar-arrow")].map((node) => node.getBoundingClientRect().left);
    await expect((first ?? 0) > (second ?? 0)).toBe(true);
  },
};
export const ThreeMonthsDark: Story = { ...ThreeMonths, name: "Three months, dark", ...dark };
export const ThreeMonths320: Story = { args: { start: "months3" }, name: "Three months, 320 (short labels)", ...at320 };
export const ThreeMonthsDark320: Story = { args: { start: "months3" }, name: "Three months, dark, 320", ...at320, ...dark };
/** One month stepped back: both arrows work, and the label is the month. */
export const MonthStepped: Story = { args: { start: "month-back" } };
export const MonthSteppedDark: Story = { args: { start: "month-back" }, name: "Month stepped, dark", ...dark };
export const Year: Story = { args: { start: "year" } };
/** הכול hides the arrows and keeps their slots, so the label stays centred. */
export const All: Story = { args: { start: "all" } };
export const AllOnProject: Story = { args: { start: "all", scope: "project" }, name: "All, on a project (מתחילת הפרויקט)" };
export const AllOnProjectDark: Story = { args: { start: "all", scope: "project" }, name: "All, on a project, dark", ...dark };
/** A custom range from the sheet: no preset is selected and the label shows the dates. */
export const Custom: Story = { args: { start: "custom" } };
export const Custom320: Story = { args: { start: "custom" }, name: "Custom, 320", ...at320 };
export const Page: Story = { args: { start: "months3", tone: "page" }, name: "Page tone" };
export const PageDark: Story = { args: { start: "months3", tone: "page" }, name: "Page tone, dark", ...dark };
