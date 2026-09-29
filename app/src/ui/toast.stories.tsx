import { useLayoutEffect, useRef } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { TabBar } from "./tab-bar";
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
