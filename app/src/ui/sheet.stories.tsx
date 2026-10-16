import { useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "@storybook/test";
import { Button } from "./button";
import { HoldLine } from "./hold-line";
import { forceReducedMotion } from "./reduced-motion";
import { Sheet } from "./sheet";
import { longHebrew, padded } from "./story-support";
import { TextField } from "./text-field";

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

/** FLOW-310: the opener takes focus back after the sheet closes; after Escape its ring shows. */
function ReturnFocusSheet() {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={opener}
        type="button"
        className="ui-btn ui-btn-secondary"
        onClick={() => {
          setOpen(true);
        }}
      >
        ניתוק
      </button>
      <Sheet open={open} onOpenChange={setOpen} title="לנתק?" returnFocusRef={opener}>
        <p className="t-label">החיבור יופסק.</p>
      </Sheet>
    </>
  );
}

/** The saving frame: no ✕, the field reads, and the primary button spins as "שומר…". */
function BusySheet() {
  const [open, setOpen] = useState(true);
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title="תקופה"
      busy
      action={
        <Button variant="primary" full busy disabled>
          שומר…
        </Button>
      }
    >
      <TextField label="שם הפרויקט" defaultValue="בית ברחוב הדקל" readOnly />
    </Sheet>
  );
}

/** A close is refused once (an incomplete change); the hold line says why, and ביטול השינוי drops it. */
function RefusingSheet() {
  const [open, setOpen] = useState(true);
  const refuse = useRef(true);
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title="לשנות את הקטגוריה?"
      onBeforeClose={() => {
        if (!refuse.current) return undefined;
        refuse.current = false;
        return false;
      }}
      action={
        <HoldLine
          onDiscard={() => {
            refuse.current = false;
            setOpen(false);
          }}
        >
          בחרו קטגוריה.
        </HoldLine>
      }
    >
      <p className="t-label">כללי · חומרים</p>
    </Sheet>
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
export const Busy: Story = {
  args: { open: true, onOpenChange: () => undefined, title: "תקופה" },
  render: () => <BusySheet />,
};
export const Refusing: Story = {
  args: { open: true, onOpenChange: () => undefined, title: "לשנות את הקטגוריה?" },
  render: () => <RefusingSheet />,
};
export const ReducedMotion: Story = {
  args: { open: true, onOpenChange: () => undefined, title: "תקופה" },
  decorators: [forceReducedMotion],
  render: () => <OpenSheet title="תקופה" body="בלי תנועה: המצב הסופי מיד." />,
};
export const ReturnFocusAfterEscape: Story = {
  args: { open: false, onOpenChange: () => undefined, title: "לנתק?" },
  render: () => <ReturnFocusSheet />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const opener = page.getByRole("button", { name: "ניתוק" });
    await userEvent.click(opener);
    await page.findByRole("dialog", { name: "לנתק?" });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(opener).toHaveFocus(), { timeout: 2000 });
    await expect(opener).toHaveAttribute("data-focus-ring");
  },
};
