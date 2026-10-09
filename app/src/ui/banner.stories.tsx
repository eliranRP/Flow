import type { Meta, StoryObj } from "@storybook/react";
import { Banner, BannerRows, Notice, type BannerRow } from "./banner";
import { CalendarIcon, CloseIcon, DocumentIcon, ReviewIcon } from "./icons";
import { IconButton } from "./icon-button";
import { filedTodayBannerTitle } from "../filed-today-copy";
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
const unpaidIcon = <DocumentIcon size={24} stroke={1.9} />;
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
// FLOW-403. The third row: late recurring bills, a count with no total.
const missingRow: BannerRow = {
  id: "missing",
  to: "/missing-bills",
  icon: <CalendarIcon size={24} stroke={1.9} />,
  title: <><bdi dir="ltr">2</bdi> חשבונות לא הגיעו</>,
};
export const RowsThree: Story = {
  name: "Rows, three",
  args: { title: "" },
  render: () => <BannerRows rows={[reviewRow, unpaidRow, missingRow]} />,
};
export const RowsThreeDark: Story = { ...RowsThree, name: "Rows, three, dark", globals: { theme: "dark" } };
export const RowsThree320: Story = { ...RowsThree, name: "Rows, three, 320", parameters: { viewport: { defaultViewport: "flow320" } } };
export const RowsMissingOnly: Story = {
  name: "Rows, missing only",
  args: { title: "" },
  render: () => <BannerRows rows={[missingRow]} />,
};
export const RowsMissingOne: Story = {
  name: "Rows, one late bill",
  args: { title: "" },
  render: () => <BannerRows rows={[reviewRow, { ...missingRow, title: "חשבון אחד לא הגיע" }]} />,
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
  args: { title: "3 שויכו אוטומטית היום" },
  render: (args) => <Banner {...args} icon={<ReviewIcon />} action={<TextLink to="/review">לרשימה</TextLink>} />,
};
// The one-line banner on לאישור: the hint sits after the title, the close button at the end.
function SlimFiled({ count }: { count: number }) {
  return (
    <Banner
      slim
      icon={<ReviewIcon />}
      title={filedTodayBannerTitle(count)}
      hint={<TextLink to="/review/filed">לרשימה</TextLink>}
      action={
        <IconButton label="סגירה" onClick={() => undefined}>
          <CloseIcon />
        </IconButton>
      }
    />
  );
}
export const Slim: Story = { args: { title: "" }, render: () => <SlimFiled count={12} /> };
export const SlimDark: Story = { ...Slim, name: "Slim, dark", globals: { theme: "dark" } };
export const SlimSingular: Story = { args: { title: "" }, render: () => <SlimFiled count={1} /> };
export const Slim320: Story = {
  ...Slim,
  name: "Slim, 320",
  parameters: { viewport: { defaultViewport: "flow320" } },
  render: () => <SlimFiled count={1234} />,
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
