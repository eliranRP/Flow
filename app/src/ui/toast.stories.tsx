import { useLayoutEffect, useRef } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { booksClosedNote, booksClosedSettingNote } from "../company-role-cache";
import { ActionBar, ActionBarRow } from "./action-bar";
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

/** Above the tab bar, clear of the actions (decision 0182). The host ignores taps; the toast does not. */
function AboveFloor(props: { children: string; action: string; tone?: "ok" | "bad" | "info" }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = host.current;
    if (!node) return;
    placeToast(node);
  }, []);
  return (
    <div className="relative min-h-dvh">
      <header className="ui-page">
        <h1 className="t-total">לאישור</h1>
        <p className="t-line2 mt-4 text-text-secondary">תנועות שמחכות לשיוך</p>
      </header>
      <div className="ui-toast-slot" />
      <ActionBar>
        <button className="ui-btn ui-btn-primary" type="button">אישור</button>
        <button className="ui-btn ui-btn-link" type="button">דלג</button>
      </ActionBar>
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
  render: () => <AboveFloor action="ביטול">הפריט אושר</AboveFloor>,
};

export const ErrorRetry: Story = {
  args: { children: "לא נשמר – אין חיבור", action: "ניסיון חוזר", tone: "bad" },
  render: () => (
    <AboveFloor action="ניסיון חוזר" tone="bad">
      לא נשמר – אין חיבור
    </AboveFloor>
  ),
};
export const Skip: Story = {
  args: { children: "דילגנו על הפריט" },
  render: () => <AboveFloor action="">דילגנו על הפריט</AboveFloor>,
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
function ShortSheetToast({ children }: { children: string }) {
  return (
    <>
      <header className="ui-page">
        <p className="t-line2">הגדרות</p>
        <h1 className="t-total">קטגוריות</h1>
      </header>
      <Sheet
        open
        onOpenChange={() => undefined}
        title="קטגוריה חדשה"
        action={<Button>שמירה</Button>}
      >
        <TextField label="שם" value="" onChange={() => undefined} />
      </Sheet>
      <PlacedToast>{children}</PlacedToast>
    </>
  );
}

/** A form under the header. The toast sits above the floor, off the segmented controls. */
function FormToastStory() {
  return (
    <>
      <header className="ui-page">
        <h1 className="t-total">פרטי העסק</h1>
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
  render: () => <ShortSheetToast>במצב תצוגה זה לא נשמר.</ShortSheetToast>,
  globals: {
    viewport: {
      value: "flow390-short",
      isRotated: false
    }
  },
};

export const FormToast: Story = {
  args: { children: "במצב תצוגה זה לא נשמר." },
  render: () => <FormToastStory />,
  globals: {
    viewport: {
      value: "flow390-short",
      isRotated: false
    }
  },
};

/** FLOW-1166 / FLOW-1170: the closed-books refusals are about 20 words, so they wrap at 320 (the toast is 8s). */
const CLOSED_THROUGH = "2026-05-31";

/** The line refusal (FLOW-1166) over a page: an edit to a closed line, shown as the toast. */
function ClosedLineToast({ children }: { children: string }) {
  return (
    <>
      <header className="ui-page">
        <p className="t-line2">תנועות</p>
        <h1 className="t-total">הוצאה</h1>
      </header>
      <form className="ui-page-pad ui-stack">
        <TextField label="תיאור" value="ספק לדוגמה" onChange={() => undefined} />
      </form>
      <PlacedToast>{children}</PlacedToast>
    </>
  );
}

/** The setting refusal (FLOW-1170) on a short sheet, as the date and category sheets show it. */
export const BooksClosedSetting: Story = {
  args: { children: booksClosedSettingNote(CLOSED_THROUGH) },
  render: () => <ShortSheetToast>{booksClosedSettingNote(CLOSED_THROUGH)}</ShortSheetToast>,
  globals: {
    viewport: {
      value: "flow320-short",
      isRotated: false
    }
  },
};

export const BooksClosedLine: Story = {
  args: { children: booksClosedNote(CLOSED_THROUGH) },
  render: () => <ClosedLineToast>{booksClosedNote(CLOSED_THROUGH)}</ClosedLineToast>,
  globals: {
    viewport: {
      value: "flow320-short",
      isRotated: false
    }
  },
};

/** Decision 0212: on לאישור the toast sits under the header, clear of the pinned bar. */
function UnderHeader({ children }: { children: string }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = host.current;
    if (!node) return;
    const place = () => { placeToast(node); };
    place();
    const timers = [50, 150, 320].map((ms) => window.setTimeout(place, ms));
    return () => { for (const timer of timers) window.clearTimeout(timer); };
  }, []);
  return (
    <div className="ui-review-queue" data-bar="">
      <header className="ui-page">
        <h1 className="t-total">לאישור</h1>
      </header>
      <ActionBar>
        <Button full>אישור</Button>
        <ActionBarRow>
          <Button variant="secondary">שינוי</Button>
          <Button variant="link">דלג</Button>
        </ActionBarRow>
      </ActionBar>
      <div className="ui-toast-host" data-place="top" ref={host}>
        <Toast action="ביטול" onAction={() => undefined}>{children}</Toast>
      </div>
      <TabBar />
    </div>
  );
}

/** FLOW-426: a message in parts wraps only at its "·", never inside a part (the viewer note at 320). */
export const ViewerNote: Story = {
  args: { children: "צפייה בלבד · שינויים נעשים על ידי בעל העסק", tone: "info" },
  render: () => <UnderHeader>צפייה בלבד · שינויים נעשים על ידי בעל העסק</UnderHeader>,
};
