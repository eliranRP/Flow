import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./button";
import { Sheet } from "./sheet";
import { longHebrew, padded } from "./story-support";

function OpenSheet({ title, body, initial = true }: { title: string; body: string; initial?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        פתיחה
      </Button>
      <Sheet open={open} onOpenChange={setOpen} title={title}>
        <p className="t-label">{body}</p>
      </Sheet>
    </>
  );
}

const meta = {
  title: "Components/Sheet",
  component: Sheet,
  decorators: [padded],
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { open: true, onOpenChange: () => undefined, title: "תקופה", children: <p className="t-label">בחירת תקופה</p> },
  render: () => <OpenSheet title="תקופה" body="החודש, חודש קודם, או כל התקופה." />,
};
export const Closed: Story = {
  args: { open: false, onOpenChange: () => undefined, title: "תקופה" },
  render: () => <OpenSheet title="תקופה" body="סגור בהתחלה" initial={false} />,
};
export const LongHebrew: Story = {
  args: { open: true, onOpenChange: () => undefined, title: longHebrew },
  render: () => <OpenSheet title={longHebrew} body={longHebrew} />,
};
