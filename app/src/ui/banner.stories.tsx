import type { Meta, StoryObj } from "@storybook/react";
import { Banner, Notice } from "./banner";
import { longHebrew, padded } from "./story-support";

const meta = {
  title: "Components/Banner",
  component: Banner,
  decorators: [padded],
} satisfies Meta<typeof Banner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { title: "3 פריטים ממתינים לאישור", hint: "הרווח כבר כולל אותם", to: "/review", count: 3 },
};
export const EmptyCount: Story = {
  args: { title: "אין ממתינים", hint: "התור ריק" },
};
export const LargeCount: Story = {
  args: { title: "פריטים ממתינים לאישור", to: "/review", count: 120 },
};
export const LongHebrew: Story = {
  args: { title: longHebrew, hint: longHebrew, to: "/review", count: 7 },
};
export const NoticeNeutral: Story = {
  args: { title: "מצב תצוגה" },
  render: () => <Notice title="מצב תצוגה" body="המספרים כאן הם דוגמה. שום דבר לא נשמר." />,
};
export const NoticeError: Story = {
  args: { title: "לא הצלחנו להתחבר" },
  render: () => (
    <Notice
      tone="bad"
      title="לא הצלחנו להתחבר"
      body="אולי אין חיבור לאינטרנט, או ש-Google לא אישרה את החשבון. כדאי לבדוק את החיבור ולנסות שוב."
    />
  ),
};
export const NoticeLong: Story = {
  args: { title: longHebrew },
  render: () => <Notice tone="bad" title={longHebrew} body={longHebrew} />,
};
