import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { AttentionCards } from "./attention-cards";
import type { BannerRow } from "./banner";
import { InvoiceIcon, RepeatIcon, TrendUpIcon } from "./icons";
import { longHebrew, padded } from "./story-support";

/** FLOW-1043: the "דורש טיפול" row-cards. Invented rows; each story starts with nothing hidden. */
const ROWS: BannerRow[] = [
  { id: "changes", to: "/recurring/changes", title: "4 חיובים קבועים השתנו", icon: <TrendUpIcon size={20} />, dismissKey: "changes:4" },
  { id: "gym", to: "/recurring", title: "חדר כושר לא חויב החודש", icon: <RepeatIcon size={20} />, dismissKey: "late:gym:1" },
  { id: "unpaid", to: "/unpaid", title: "3 חשבוניות פתוחות · $21,300", icon: <InvoiceIcon size={20} />, dismissKey: "unpaid:3:2130000" },
];

const REVIEW: BannerRow = { id: "review", to: "/review", title: "3 תנועות לסקירה", button: { label: "לסקירה", hint: "3 תנועות" } };

const meta = {
  title: "Components/AttentionCards",
  component: AttentionCards,
  tags: ["autodocs"],
  decorators: [padded],
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

export const LongTitle: Story = {
  args: { rows: [{ id: "long", to: "/recurring", title: longHebrew, icon: <RepeatIcon size={20} />, dismissKey: "long:1" }, ...ROWS.slice(1)] },
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
    await expect(canvas.getByRole("button", { name: "ביטול" })).toBeVisible();
  },
};
