import type { Meta, StoryObj } from "@storybook/react";
import { Banner, Notice } from "./banner";
import { ReviewIcon } from "./icons";
import { longHebrew, padded } from "./story-support";
import { TextLink } from "./text-link";

const meta = {
  title: "Components/Banner",
  component: Banner,
  decorators: [padded],
} satisfies Meta<typeof Banner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { title: "7 פריטים ממתינים לאישור", to: "/review" },
  render: (args) => (
    <Banner
      {...args}
      hint={
        <>
          3 חשבוניות לא שולמו · <bdi dir="ltr">₪23,400</bdi>
        </>
      }
    />
  ),
};
export const UnpaidOnly: Story = {
  args: { title: "3 חשבוניות לא שולמו", to: "/unpaid" },
  render: (args) => (
    <Banner
      {...args}
      hint={
        <>
          <bdi dir="ltr">₪23,400</bdi> · טרם נגבה
        </>
      }
    />
  ),
};
export const LongHebrew: Story = {
  args: { title: longHebrew, hint: longHebrew, to: "/review" },
};
export const WithAction: Story = {
  args: { title: "3 תנועות שויכו היום בלי להמתין בתור" },
  render: (args) => <Banner {...args} icon={<ReviewIcon />} action={<TextLink to="/review">צפייה</TextLink>} />,
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
      body="אולי אין חיבור לאינטרנט, או ש־Google לא אישרה את החשבון. כדאי לבדוק את החיבור ולנסות שוב."
    />
  ),
};
export const NoticeLong: Story = {
  args: { title: longHebrew },
  render: () => <Notice tone="bad" title={longHebrew} body={longHebrew} />,
};
