import type { Meta, StoryObj } from "@storybook/react-vite";
import { Banner, BannerRows, Notice, type BannerRow } from "./banner";
import { CalendarIcon, DocumentIcon, ReviewIcon, TrendUpIcon } from "./icons";
import { HintParts } from "./hint-parts";
import { longHebrew, padded } from "./story-support";
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
  title: <><bdi dir="ltr">3</bdi> חשבוניות פתוחות</>,
  hint: <><bdi dir="ltr">₪23,400</bdi> · לגבייה</>,
};
const reviewOne: BannerRow = { id: "review", to: "/review", title: "פריט אחד ממתין לאישור" };
const unpaidOne: BannerRow = {
  id: "unpaid",
  to: "/unpaid",
  icon: unpaidIcon,
  title: "חשבונית פתוחה אחת",
  hint: <><bdi dir="ltr">₪4,680</bdi> · לגבייה</>,
};

// FLOW-403. The third row: late recurring bills, a count with no total.
const missingRow: BannerRow = {
  id: "missing",
  to: "/recurring",
  icon: <CalendarIcon size={24} stroke={1.9} />,
  title: <><bdi dir="ltr">2</bdi> חשבונות לא הגיעו</>,
};
// FLOW-415 (layout A). The last row: a payment well above its usual amount; a tap opens the payment.
const changeRow: BannerRow = {
  id: "change:t1",
  to: "/transactions/t1",
  icon: <TrendUpIcon size={24} stroke={1.9} />,
  title: "חשמל עלה ב־38%",
  hint: <HintParts parts={[<bdi key="now" dir="ltr">₪2,550</bdi>, <>בדרך כלל <bdi dir="ltr">₪1,850</bdi></>]} />,
};
/** The pending card's rows: review, unpaid, late bills and a charge above usual, alone or together (the control picks the set). */
const ROW_SETS: Record<string, BannerRow[]> = {
  "review and unpaid": [reviewRow, unpaidRow],
  "review only": [reviewRow],
  "unpaid only": [unpaidRow],
  "one of each": [reviewOne, unpaidOne],
  "three": [reviewRow, unpaidRow, missingRow],
  "late bill only": [missingRow],
  "one late bill": [reviewRow, { ...missingRow, title: "חשבון אחד לא הגיע" }],
  "a charge above usual": [{ ...reviewRow, title: <><bdi dir="ltr">2</bdi> פריטים ממתינים לאישור</> }, missingRow, changeRow],
  "a charge above usual only": [changeRow],
};
export const Rows: StoryObj<{ set: string }> = {
  args: { set: "review and unpaid" },
  argTypes: { set: { control: "select", options: Object.keys(ROW_SETS) } },
  render: ({ set }) => <BannerRows rows={ROW_SETS[set] ?? []} />,
};
export const RowsLongHebrew: Story = {
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
