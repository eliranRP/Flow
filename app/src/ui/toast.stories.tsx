import { useLayoutEffect, useRef } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./button";
import { SegmentedControl } from "./segmented-control";
import { Sheet } from "./sheet";
import { TabBar } from "./tab-bar";
import { TextField } from "./text-field";
import { placeToast, Toast } from "./toast";
import "./toast.stories.css";

const meta = {
  title: "Components/Toast",
  component: Toast,
} satisfies Meta<typeof Toast>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Under the title, clear of the actions. The host ignores taps; the toast does not. */
function BelowHeader(props: { children: string; action: string; tone?: "ok" | "bad" | "info" }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = host.current;
    if (!node) return;
    placeToast(node);
  }, []);
  return (
    <div className="relative min-h-dvh">
      <header className="ui-page">
        <h1 className="t-title-1">לאישור</h1>
        <p className="t-label mt-4 text-text-secondary">מסמכים שמחכים לשיוך</p>
      </header>
      <div className="ui-toast-slot" />
      <div className="ui-review-actions">
        <button className="ui-btn ui-btn-primary" type="button">אישור</button>
        <button className="ui-btn ui-btn-ghost" type="button">דלג</button>
      </div>
      <div className="ui-toast-host" ref={host}>
        <Toast action={props.action} onAction={() => undefined} tone={props.tone}>
          {props.children}
        </Toast>
      </div>
      <TabBar />
    </div>
  );
}

export const Undo: Story = {
  args: { children: "הפריט אושר", action: "ביטול" },
  render: () => <BelowHeader action="ביטול">הפריט אושר</BelowHeader>,
};
export const ErrorRetry: Story = {
  args: { children: "לא נשמר – אין חיבור", action: "ניסיון חוזר", tone: "bad" },
  render: () => (
    <BelowHeader action="ניסיון חוזר" tone="bad">
      לא נשמר – אין חיבור
    </BelowHeader>
  ),
};
export const Skip: Story = {
  args: { children: "דילגנו על הפריט" },
  render: () => <BelowHeader action="">דילגנו על הפריט</BelowHeader>,
};

function PlacedToast({ children }: { children: string }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = host.current;
    if (!node) return;
    const place = () => { placeToast(node); };
    place();
    const timers = [50, 150, 320, 500].map((ms) => window.setTimeout(place, ms));
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, []);
  return (
    <div className="ui-toast-host" ref={host}>
      <Toast tone="info">{children}</Toast>
    </div>
  );
}

/** A short sheet: the toast sits clear of שמירה, above the sheet when the sheet has no room. */
function ShortSheetToast() {
  return (
    <>
      <header className="ui-page">
        <p className="t-label">הגדרות</p>
        <h1 className="t-title-1">קטגוריות</h1>
      </header>
      <Sheet
        open
        onOpenChange={() => undefined}
        title="קטגוריה חדשה"
        action={<Button>שמירה</Button>}
      >
        <TextField label="שם" value="" onChange={() => undefined} />
      </Sheet>
      <PlacedToast>במצב תצוגה זה לא נשמר.</PlacedToast>
    </>
  );
}

/** A form directly under the header. The toast stays off the segmented controls. */
function FormUnderHeader() {
  return (
    <>
      <header className="ui-page">
        <h1 className="t-title-1">פרטי העסק</h1>
      </header>
      <form className="ui-page-pad ui-stack">
        <TextField label="שם העסק" value="בדיקה" onChange={() => undefined} />
        <SegmentedControl
          label="סוג העוסק"
          value="registered"
          onChange={() => undefined}
          options={[
            { value: "registered", label: "עוסק מורשה" },
            { value: "exempt", label: "עוסק פטור" },
          ]}
        />
      </form>
      <PlacedToast>במצב תצוגה זה לא נשמר.</PlacedToast>
    </>
  );
}

export const ShortSheet: Story = {
  args: { children: "במצב תצוגה זה לא נשמר." },
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => <ShortSheetToast />,
};

export const FormUnderHeaderToast: Story = {
  args: { children: "במצב תצוגה זה לא נשמר." },
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => <FormUnderHeader />,
};
