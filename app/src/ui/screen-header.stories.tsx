import type { Meta, StoryObj } from "@storybook/react";
import { expect, waitFor } from "@storybook/test";
import { BackButton } from "./back";
import { CloseIcon } from "./icons";
import { ScreenHeader } from "./screen-header";
import { longHebrew, padded } from "./story-support";

const meta = {
  title: "Components/ScreenHeader",
  component: ScreenHeader,
  decorators: [padded],
} satisfies Meta<typeof ScreenHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { title: "עזרה", subtitle: "לעזרה בכניסה כותבים לנו." } };
export const WithBack: Story = { args: { title: "חשבוניות פתוחות", backTo: "/" } };
export const LongHebrew: Story = { args: { title: longHebrew, subtitle: longHebrew, backTo: "/" } };

/**
 * FLOW-334 H1: once the large title scrolls off, a compact bar keeps Back and a small title at the
 * top. Invented rows.
 */
export const CompactBarScrolled: Story = {
  args: { title: "שויכו היום", backTo: "/review" },
  render: () => (
    <div>
      <ScreenHeader title="שויכו היום" subtitle="12 תנועות" backTo="/review" />
      {Array.from({ length: 40 }, (_, index) => (
        <p key={index} className="ui-page-pad t-body" style={{ paddingBlock: 12 }}>
          {`תנועה לדוגמה ${String(index + 1)}`}
        </p>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const doc = canvasElement.ownerDocument;
    doc.defaultView?.scrollTo(0, 400);
    await waitFor(() => expect(doc.querySelector(".ui-compact-bar")?.classList.contains("m-bar-in")).toBe(true));
  },
};
/** A tab root keeps the title on the bar next to its action. */
export const InlineWithAction: Story = {
  args: { title: "פרויקטים", layout: "inline" },
  render: () => <ScreenHeader title="פרויקטים" layout="inline" action={<span className="t-hint">פעולה</span>} />,
};
export const Stacked: Story = {
  args: { title: "פיצול בין פרויקטים", layout: "stacked", subtitle: "מלט לקיר" },
  render: () => (
    <ScreenHeader
      layout="stacked"
      title="פיצול בין פרויקטים"
      subtitle="מלט לקיר"
      leading={<BackButton label="סגירה" fallback="/"><CloseIcon /></BackButton>}
      trailing={<span className="t-hint">דוגמה</span>}
    />
  ),
};
