import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { AttentionCards } from "./attention-cards";
import type { BannerRow } from "./banner";
import { AlertIcon, CalendarIcon, InvoiceIcon, RepeatIcon, TrendUpIcon } from "./icons";
import { longHebrew, oneLineAttention, padded, withToasts } from "./story-support";

/** FLOW-1043: the "דורש טיפול" row-cards. Invented rows; each story starts with nothing hidden. */
const ROWS: BannerRow[] = [
  { id: "changes", to: "/recurring/changes", title: "4 חיובים קבועים השתנו", short: "חיובים קבועים השתנו", tag: "4", icon: <TrendUpIcon size={20} />, dismissKey: "changes:4" },
  // No short title: under 360px the title is cut at its end.
  { id: "gym", to: "/recurring", title: "חדר כושר לא חויב החודש", icon: <RepeatIcon size={20} />, dismissKey: "late:gym:1" },
  { id: "unpaid", to: "/unpaid", title: "3 חשבוניות פתוחות · $21,300", short: "לגבייה", tag: "$21,300", icon: <InvoiceIcon size={20} />, dismissKey: "unpaid:3:2130000" },
];

/** FLOW-1097: the owner's choice B, one card of each kind the pages build. */
const ONE_LINE: BannerRow[] = [
  { id: "check-2", to: "/loans/1", title: "2 תשלומים ממתינים לבדיקה · משכנתא אלון", short: "לבדיקה", tag: "2 תשלומים", icon: <AlertIcon size={20} />, dismissKey: "check:2" },
  { id: "check-1", to: "/loans/2", title: "תשלום אחד ממתין לבדיקה · הלוואת ציוד", short: "לבדיקה", tag: "תשלום אחד", icon: <AlertIcon size={20} />, dismissKey: "check:1" },
  { id: "soon", to: "/loans/2", title: "תשלום הלוואת ציוד בעוד 8 ימים · $1,312", short: "הלוואת ציוד", tag: "בעוד 8 ימים", icon: <CalendarIcon size={20} />, dismissKey: "soon:2026-10-23" },
  ...ROWS.filter((row) => row.short != null),
];

const REVIEW: BannerRow = { id: "review", to: "/review", title: "3 תנועות לסקירה", button: { label: "לסקירה", hint: "3 תנועות" } };

const meta = {
  title: "Components/AttentionCards",
  component: AttentionCards,
  tags: ["autodocs"],
  decorators: [padded, withToasts],
  args: { rows: ROWS, storageKey: "story" },
  beforeEach: () => {
    try {
      window.localStorage.removeItem("flow.attention.story");
    } catch {
      // No storage: nothing to clear.
    }
  },
} satisfies Meta<typeof AttentionCards>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** The review row comes first and has no X. */
export const WithReview: Story = { args: { rows: [...ROWS, REVIEW] } };

/** A long title is cut at its end at 393; under 360px its short title and tag take its place on one line. */
export const LongTitle: Story = {
  args: { rows: [{ id: "long", to: "/recurring", title: longHebrew, short: "שיפוץ הגג", tag: "$21,300", icon: <RepeatIcon size={20} />, dismissKey: "long:1" }, ...ROWS.slice(1)] },
};

/** FLOW-1097: at 320 the long title's card is "שיפוץ הגג" and its tag, one line; the X and chevron stay. */
export const LongTitle320: Story = {
  ...LongTitle,
  globals: { viewport: { value: "flow320", isRotated: false } },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.ownerDocument.documentElement.clientWidth).toBeLessThanOrEqual(320);
    await expect(oneLineAttention(canvasElement)).toEqual(["שיפוץ הגג · $21,300", "לגבייה · $21,300"]);
    await expect(within(canvasElement).getByRole("link", { name: longHebrew })).toBeInTheDocument();
  },
};

/** FLOW-1097 (the owner's choice B): at 320 each card is a short title and a tag, on one line, nothing cut. */
export const OneLine320: Story = {
  args: { rows: ONE_LINE },
  globals: { viewport: { value: "flow320", isRotated: false } },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.ownerDocument.documentElement.clientWidth).toBeLessThanOrEqual(320);
    await expect(oneLineAttention(canvasElement)).toEqual([
      "לבדיקה · 2 תשלומים",
      "לבדיקה · תשלום אחד",
      "הלוואת ציוד · בעוד 8 ימים",
      "חיובים קבועים השתנו · 4",
      "לגבייה · $21,300",
    ]);
    await expect(within(canvasElement).getByRole("link", { name: "3 חשבוניות פתוחות · $21,300" })).toBeInTheDocument();
  },
};

/** At 393 the same cards keep their full one-line titles. */
export const OneLine393: Story = {
  args: { rows: ONE_LINE },
  globals: { viewport: { value: "flow393", isRotated: false } },
  play: async ({ canvasElement }) => {
    for (const short of canvasElement.querySelectorAll(".ui-attn-short")) await expect(getComputedStyle(short).display).toBe("none");
    await expect(within(canvasElement).getByText("2 תשלומים ממתינים לבדיקה · משכנתא אלון")).toBeVisible();
  },
};

/** The X slides the card toward itself and folds it; the head offers "1 הוסתרו · הצגה", which brings it back. */
export const HideAndRestore: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "הסתרה: חדר כושר לא חויב החודש" }));
    await waitFor(() => expect(canvas.queryByText("חדר כושר לא חויב החודש")).toBeNull());
    await userEvent.click(canvas.getByRole("button", { name: "1 הוסתרו · הצגה" }));
    await expect(canvas.getByText("חדר כושר לא חויב החודש")).toBeVisible();
  },
};

/** Every card hidden: one line, "אין מה לטפל · הכול נסקר", and ביטול. */
export const AllHidden: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const title of ["4 חיובים קבועים השתנו", "חדר כושר לא חויב החודש", "3 חשבוניות פתוחות · $21,300"]) {
      await userEvent.click(canvas.getByRole("button", { name: `הסתרה: ${title}` }));
    }
    await waitFor(() => expect(canvas.getByText("אין מה לטפל · הכול נסקר")).toBeVisible());
    // The section's own ביטול; the "הוסתר" toast offers one too, for the last card only.
    const section = within(canvas.getByRole("region", { name: "דורש טיפול" }));
    await expect(section.getByRole("button", { name: "ביטול" })).toBeVisible();
  },
};
