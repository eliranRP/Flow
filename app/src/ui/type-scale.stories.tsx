import type { Meta, StoryObj } from "@storybook/react";
import { Amount } from "./amount";
import { padded } from "./story-support";

/** The type roles from the canvas Design guide (FLOW-363). Sample words only, no real data. */
const STYLES = [
  { name: "band · 52/500", className: "t-band", text: "−₪17,191", amount: true },
  { name: "detail · 40/400", className: "t-detail", text: "₪1,240", amount: true },
  { name: "total · 34/400", className: "t-total", text: "₪42,069", amount: true },
  { name: "title · 32/600", className: "t-title", text: "חשבוניות פתוחות" },
  { name: "card · 28/400", className: "t-card", text: "₪48,600", amount: true },
  { name: "name · 24/600", className: "t-name", text: "ספק לדוגמה" },
  { name: "sheet · 20/600", className: "t-sheet", text: "כל כמה זמן" },
  { name: "section · 20/500", className: "t-section", text: "היום · 11/10" },
  { name: "body · 17/400", className: "t-body", text: "7 פריטים ממתינים לאישור" },
  { name: "btn · 17/500", className: "t-btn", text: "אישור" },
  { name: "btn-2 · 16/500", className: "t-btn-2", text: "שינוי" },
  { name: "line2 · 15/400", className: "t-line2", text: "חומרים · פרויקט לדוגמה" },
  { name: "meta · 14/400", className: "t-meta", text: "05/10 · יצא" },
  { name: "chip · 14/500", className: "t-chip", text: "לפי סכום" },
  { name: "caption · 13/400", className: "t-caption", text: "לפני מע״מ" },
] as const;

function TypeScale() {
  return (
    <div className="flex flex-col gap-4">
      {STYLES.map((style) => (
        <div key={style.name} className="flex flex-col gap-1">
          <span className="t-hint" dir="ltr">{style.name}</span>
          <p className={style.className}>
            {"amount" in style ? <bdi dir="ltr" className="num">{style.text}</bdi> : style.text}
          </p>
        </div>
      ))}
      <div className="flex flex-col gap-1">
        <span className="t-hint" dir="ltr">list amount · body 17/400, cents 11</span>
        <p className="t-body flex gap-4">
          <Amount agorot={350_000n} direction="income" income cents="always" />
          <Amount agorot={123_456n} direction="expense" cents="always" />
          <Amount agorot={98_700n} />
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
