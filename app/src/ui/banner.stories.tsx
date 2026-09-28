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
  args: { title: "7 פריטים ממתינים לאישור", hint: "3 חשבוניות לא שולמו · ₪23,400", to: "/review" },
};
export const UnpaidOnly: Story = {
  args: { title: "3 חשבוניות לא שולמו", hint: "לא נכלל ברווח", to: "/unpaid" },
};
export const LongHebrew: Story = {
  args: { title: longHebrew, hint: longHebrew, to: "/review" },
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
