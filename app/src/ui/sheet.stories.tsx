import { useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "@storybook/test";
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
