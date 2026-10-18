import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { ForecastAmountField, ForecastBars } from "./forecast-edit-parts";

const meta = {
  title: "Components/ForecastEditParts",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Field({ initial, income = false }: { initial: string; income?: boolean }) {
  const [value, setValue] = useState(initial);
  return <ForecastAmountField value={value} onChange={setValue} mark="$" sign={income ? "+" : "−"} income={income} label="סכום צפוי" />;
}

/** The amount field: an expense, income, and empty (the mark and a muted 0). */
export const AmountField: Story = {
  render: () => (
    <div className="ui-fe-page">
      <Field initial="1,200" />
      <Field initial="2,300" income />
      <Field initial="" />
    </div>
  ),
};

/** Five months of a category in the project and the forecast month's dashed bar. */
export const Bars: Story = {
  render: () => (
    <div className="ui-fe-page">
      <ForecastBars
        months={[["2026-05", "מאי", 34_000n], ["2026-06", "יוני", 41_000n], ["2026-07", "יולי", 24_000n], ["2026-08", "אוג׳", 30_000n], ["2026-09", "ספט׳", 26_000n]].map(
          ([key, label, minor]) => ({ key: key as string, label: label as string, minor: minor as bigint }),
        )}
        forecast={{ key: "2026-11", label: "נוב׳ · צפי", minor: 120_000n }}
      />
    </div>
  ),
};
