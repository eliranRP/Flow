import type { Meta, StoryObj } from "@storybook/react";
import { BigNumber } from "./big-number";
import { padded } from "./story-support";

/** The type scale from decision 0120 (option C, full Mercury). Sample words only, no real data. */
const STYLES = [
  { name: "title-1 · 34/1.15/600", className: "t-title-1", text: "פרויקטים" },
  { name: "band-title · 32/1.25/600", className: "t-band-title", text: "וילה לדוגמה" },
  { name: "heading · 20/1.3/600", className: "t-heading", text: "ספטמבר 2026" },
  { name: "title-3 · 17/1.45/600", className: "t-title-3", text: "הוצאה" },
  { name: "row title · 17/1.45/400", className: "ui-row-title", text: "ספק לדוגמה" },
  { name: "body · 16/1.5/500", className: "t-body", text: "7 פריטים ממתינים לאישור" },
  { name: "meta · 15/1.4/400", className: "t-meta ui-row-hint", text: "חומרים · 12/09" },
  { name: "hint · 13/1.45/400", className: "t-hint", text: "לפני מע״מ" },
] as const;

function TypeScale() {
  return (
    <div className="flex flex-col gap-4">
      {STYLES.map((style) => (
        <div key={style.name} className="flex flex-col gap-1">
          <span className="t-hint" dir="ltr">{style.name}</span>
          <p className={style.className} style={{ letterSpacing: style.className.startsWith("t-title-1") ? "var(--type-title-1-tracking)" : undefined }}>
            {style.text}
          </p>
        </div>
      ))}
      <div className="flex flex-col gap-1">
        <span className="t-hint" dir="ltr">amount · 17/1.45/400</span>
        <p className="t-amount flex gap-4">
          <BigNumber agorot={350_000n} direction="income" income cents="always" />
          <BigNumber agorot={123_456n} direction="expense" cents="always" />
          <BigNumber agorot={98_700n} />
        </p>
      </div>
    </div>
  );
}

const meta = {
  title: "Foundations/TypeScale",
  component: TypeScale,
  decorators: [padded],
} satisfies Meta<typeof TypeScale>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Light: Story = {};
export const Dark: Story = { globals: { theme: "dark" } };
