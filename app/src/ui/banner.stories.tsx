import type { Meta, StoryObj } from "@storybook/react";
import { Banner, BannerRows, Notice, type BannerRow } from "./banner";
import { DocumentIcon, ReviewIcon } from "./icons";
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
// FLOW-321. Home's pending card: a row to Review and a row to Unpaid with its total.
const unpaidIcon = <DocumentIcon size={22} stroke={1.9} />;
const reviewRow: BannerRow = {
  id: "review",
  to: "/review",
  title: <><bdi dir="ltr">7</bdi> פריטים ממתינים לאישור</>,
};
const unpaidRow: BannerRow = {
  id: "unpaid",
  to: "/unpaid",
  icon: unpaidIcon,
  title: <><bdi dir="ltr">3</bdi> חשבוניות לא שולמו</>,
  hint: <><bdi dir="ltr">₪23,400</bdi> · טרם נגבה</>,
};
const reviewOne: BannerRow = { id: "review", to: "/review", title: "פריט אחד ממתין לאישור" };
const unpaidOne: BannerRow = {
  id: "unpaid",
  to: "/unpaid",
  icon: unpaidIcon,
  title: "חשבונית אחת לא שולמה",
  hint: <><bdi dir="ltr">₪4,680</bdi> · טרם נגבה</>,
};

export const RowsBoth: Story = {
  name: "Rows, review and unpaid",
  args: { title: "" },
  render: () => <BannerRows rows={[reviewRow, unpaidRow]} />,
};
export const RowsBothDark: Story = { ...RowsBoth, name: "Rows, review and unpaid, dark", globals: { theme: "dark" } };
export const RowsReviewOnly: Story = {
  name: "Rows, review only",
  args: { title: "" },
  render: () => <BannerRows rows={[reviewRow]} />,
};
export const RowsUnpaidOnly: Story = {
  name: "Rows, unpaid only",
  args: { title: "" },
  render: () => <BannerRows rows={[unpaidRow]} />,
};
export const RowsSingular: Story = {
  name: "Rows, one of each",
  args: { title: "" },
  render: () => <BannerRows rows={[reviewOne, unpaidOne]} />,
};
export const RowsLongHebrew: Story = {
  name: "Rows, long Hebrew",
  args: { title: "" },
  render: () => (
    <BannerRows
      rows={[
        { id: "review", to: "/review", title: longHebrew },
        { id: "unpaid", to: "/unpaid", icon: unpaidIcon, title: longHebrew, hint: longHebrew },
      ]}
    />
  ),
};
export const LongHebrew: Story = {
  args: { title: longHebrew, hint: longHebrew, to: "/review" },
};
export const WithAction: Story = {
  args: { title: "3 תנועות שויכו אוטומטית היום" },
  render: (args) => <Banner {...args} icon={<ReviewIcon />} action={<TextLink to="/review">לרשימה</TextLink>} />,
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
