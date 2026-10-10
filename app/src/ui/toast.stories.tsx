import { useLayoutEffect, useRef } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
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
        <p className="t-label mt-4 text-text-secondary">תנועות שמחכות לשיוך</p>
      </header>
      <div className="ui-toast-slot" />
      <ActionBar>
        <button className="ui-btn ui-btn-primary" type="button">אישור</button>
        <button className="ui-btn ui-btn-ghost" type="button">דלג</button>
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

/** Decision 0137: on לאישור the toast sits just above the pinned bar, never over it. */
function AboveBar({ children }: { children: string }) {
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
        <h1 className="t-title-1">לאישור</h1>
      </header>
      <ActionBar>
        <Button full>אישור</Button>
        <ActionBarRow>
          <Button variant="secondary">שינוי</Button>
          <Button variant="ghost">דלג</Button>
        </ActionBarRow>
      </ActionBar>
      <div className="ui-toast-host" data-place="bar" ref={host}>
        <Toast action="ביטול" onAction={() => undefined}>{children}</Toast>
      </div>
      <TabBar />
    </div>
  );
}

export const PlaceBar: Story = {
  args: { children: "דילגנו על הפריט", action: "ביטול" },
  render: () => <AboveBar>דילגנו על הפריט</AboveBar>,
};
export const PlaceBarDark: Story = { ...PlaceBar, globals: { theme: "dark" } };
export const PlaceBar320: Story = { ...PlaceBar, parameters: { viewport: { defaultViewport: "flow320" } } };

/** FLOW-426: a message in parts wraps only at its "·", never inside a part (the viewer note at 320). */
export const ViewerNote320: Story = {
  args: { children: "צפייה בלבד · שינויים נעשים על ידי בעל העסק", tone: "info" },
  render: () => <AboveBar>צפייה בלבד · שינויים נעשים על ידי בעל העסק</AboveBar>,
  parameters: { viewport: { defaultViewport: "flow320" } },
};

/** The text of each hint part, without its "·" box, as boxes on screen. */
function partTextRects(part: Element): DOMRect[] {
  const walker = document.createTreeWalker(part, NodeFilter.SHOW_TEXT);
  const rects: DOMRect[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest(".ui-hint-wrap-sep")) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    rects.push(...[...range.getClientRects()].filter((rect) => rect.width > 0));
  }
  return rects;
}

/**
 * FLOW-429: in the toast at 320 (288px wide between the gutters, with ביטול) the line is narrower than the part
 * "שינויים נעשים על ידי בעל העסק", so that part wraps at its own spaces; no word is clipped.
 */
export const ViewerNoteWidePart320: Story = {
  args: { children: "צפייה בלבד · שינויים נעשים על ידי בעל העסק", tone: "info" },
  render: () => (
    <div style={{ inlineSize: 288 }}>
      <Toast action="ביטול" onAction={() => undefined} tone="info">
        צפייה בלבד · שינויים נעשים על ידי בעל העסק
      </Toast>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const clip = canvasElement.querySelector(".ui-hint-wrap");
    if (!clip) throw new Error("the toast has no hint parts");
    const box = clip.getBoundingClientRect();
    const parts = [...clip.querySelectorAll(".ui-hint-wrap-part")];
    await expect(parts).toHaveLength(2);
    const [, widePart] = parts;
    if (!widePart) throw new Error("the second part is missing");
    const wide = partTextRects(widePart);
    // The part is wider than its line, so it takes more than one line.
    await expect(new Set(wide.map((rect) => Math.round(rect.top))).size).toBeGreaterThan(1);
    const cut = parts.flatMap(partTextRects).filter(
      (rect) => rect.left < box.left - 0.5 || rect.right > box.right + 0.5 || rect.top < box.top - 0.5 || rect.bottom > box.bottom + 0.5,
    );
    await expect(cut).toEqual([]);
  },
};
