import type { Meta, StoryObj } from "@storybook/react";
import { BackButton } from "./back";
import { IconButton } from "./icon-button";
import { CloseIcon, MoreIcon } from "./icons";
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
export const TitleOnly: Story = { args: { title: "הגדרות" } };
export const WithBack: Story = { args: { title: "חשבוניות שלא שולמו", backTo: "/" } };
export const LongHebrew: Story = { args: { title: longHebrew, subtitle: longHebrew, backTo: "/" } };
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

export const Compact: Story = {
  args: { title: "הוצאה", size: "compact" },
  render: () => (
    <ScreenHeader
      title="הוצאה"
      size="compact"
      leading={<BackButton fallback="/" />}
      trailing={<IconButton label="עוד" onClick={() => undefined}><MoreIcon /></IconButton>}
    />
  ),
};
