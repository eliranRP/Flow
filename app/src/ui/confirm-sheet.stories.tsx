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
