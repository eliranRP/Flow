import type { Meta, StoryObj } from "@storybook/react-vite";
import { Banner, Notice } from "./banner";
import { ReviewIcon } from "./icons-later";
import { padded } from "./story-support";
import { Button } from "./button";

const meta = {
  title: "Components/Banner",
  component: Banner,
  decorators: [padded],
} satisfies Meta<typeof Banner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: (
      <>
        <bdi dir="ltr">7</bdi> פריטים ממתינים לאישור
      </>
    ),
    to: "/review",
  },
};
export const UnpaidOnly: Story = {
  args: { title: "3 חשבוניות פתוחות", to: "/unpaid" },
  render: (args) => (
    <Banner
      {...args}
      hint={
        <>
          <bdi dir="ltr">₪23,400</bdi> · לגבייה
        </>
      }
    />
  ),
};
export const WithAction: Story = {
  args: { title: "3 שויכו אוטומטית היום" },
  render: (args) => <Banner {...args} icon={<ReviewIcon />} action={<Button variant="link" to="/review" chevron>לרשימה</Button>} />,
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
