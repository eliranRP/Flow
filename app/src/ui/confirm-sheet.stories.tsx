import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./button";
import { ConfirmSheet } from "./confirm-sheet";
import { longHebrew, padded } from "./story-support";

function Demo({ destructive, item }: { destructive: boolean; item: string }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button
        variant="danger"
        onClick={() => {
          setOpen(true);
        }}
      >
        פתיחת אישור מחיקה
      </Button>
      <ConfirmSheet
        open={open}
        onOpenChange={setOpen}
        title={destructive ? "למחוק את ההוצאה?" : "להסתיר את הקטגוריה?"}
        item={item}
        consequence={destructive ? "הפרויקט ייעלם מהרשימה. התנועות נשארות." : "הקטגוריה לא תופיע בבחירה."}
        confirmLabel={destructive ? "מחיקה" : "הסתרה"}
        destructive={destructive}
        onConfirm={() => {
          setOpen(false);
        }}
      />
    </>
  );
}

const meta = {
  title: "Components/ConfirmSheet",
  component: ConfirmSheet,
  decorators: [padded],
  parameters: { viewport: { defaultViewport: "flow390-short" } },
} satisfies Meta<typeof ConfirmSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Destructive: Story = {
  args: {
    open: true,
    onOpenChange: () => undefined,
    title: "למחוק את ההוצאה?",
    consequence: "הפרויקט ייעלם מהרשימה.",
    confirmLabel: "מחיקה",
    onConfirm: () => undefined,
  },
  render: () => <Demo destructive item="טק-ליין" />,
};
export const Plain: Story = {
  args: {
    open: true,
    onOpenChange: () => undefined,
    title: "להסתיר את הקטגוריה?",
    consequence: "הקטגוריה לא תופיע בבחירה.",
    confirmLabel: "הסתרה",
    onConfirm: () => undefined,
  },
  render: () => <Demo destructive={false} item="כללי" />,
};
export const Merge: Story = {
  args: {
    open: true,
    onOpenChange: () => undefined,
    title: "למזג את הקטגוריה?",
    item: "כללי ← חומרים",
    consequence: "התנועות עוברות אל היעד, וכללי מוסתרת. אי אפשר להפריד אחר כך.",
    confirmLabel: "מיזוג",
    // FLOW-341: red because it can't be undone, but no bin: a merge is not a delete.
    destructive: true,
    icon: null,
    onConfirm: () => undefined,
  },
};
export const LongHebrew: Story = {
  args: {
    open: true,
    onOpenChange: () => undefined,
    title: longHebrew,
    consequence: longHebrew,
    confirmLabel: "מחיקה",
    onConfirm: () => undefined,
  },
  render: () => <Demo destructive item={longHebrew} />,
};
/** FLOW-405: a delete that sends lines back to review names the split side effect and offers the move instead. */
export const DeleteWithAlternative: Story = {
  args: {
    open: true,
    onOpenChange: () => undefined,
    title: "למחוק את הקטגוריה?",
    item: "חומרים · 42 תנועות",
    consequence: "התנועות יישארו בלי קטגוריה ויחזרו ללשונית לאישור.",
    detail: "3 מהן מפוצלות, והפיצול שלהן יימחק. ספקים שזכרו את הקטגוריה ישכחו אותה.",
    confirmLabel: "מחיקה",
    destructive: true,
    alternative: { label: "להעביר את התנועות לקטגוריה אחרת במקום", onClick: () => undefined },
    onConfirm: () => undefined,
  },
};
export const DeleteEmpty: Story = {
  args: {
    open: true,
    onOpenChange: () => undefined,
    title: "למחוק את הקטגוריה?",
    item: "אחר · אין תנועות",
    consequence: "הקטגוריה תימחק מהרשימה.",
    confirmLabel: "מחיקה",
    destructive: true,
    onConfirm: () => undefined,
  },
};
