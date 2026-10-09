import { useLayoutEffect, useRef } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { ActionBar, ActionBarRow } from "./action-bar";
import { Button } from "./button";
import { CheckIcon } from "./icons";
import { ReviewCard, REVIEW_MISMATCH_ID, REVIEW_MISSING_ID, SPLIT_MISMATCH_ACTION, SPLIT_MISMATCH_KEEP } from "./review-card";
import { TabBar } from "./tab-bar";
import { placeToast, Toast } from "./toast";

type BarArgs = {
  kind: "review" | "mismatch";
  busy?: boolean;
  disabled?: boolean;
  toast?: string;
};

/** FLOW-327: the review card with its bar pinned on the tab bar. Invented data. */
function ReviewWithBar({ kind, busy = false, disabled = false, toast }: BarArgs) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = host.current;
    if (!node || !toast) return;
    const place = () => { placeToast(node); };
    place();
    const timers = [50, 150, 320].map((ms) => window.setTimeout(place, ms));
    return () => { for (const timer of timers) window.clearTimeout(timer); };
  }, [toast]);
  const mismatch = kind === "mismatch";
  return (
    <div className="ui-review-queue" data-bar="">
      <header className="ui-page">
        <h1 className="t-title-1">לאישור</h1>
      </header>
      <div className="ui-page-pad">
        <ReviewCard
          supplier="חומרי בניין לדוגמה בע״מ"
          sourceLine="חשבונית · 21/09/2026"
          netAgorot={-850000n}
          vatLine="לפני מע״מ · מע״מ ₪1,530"
          reason={mismatch ? "split_mismatch" : undefined}
          splitParts={mismatch ? 2 : undefined}
          missingBoth={disabled}
          suggestion={disabled ? undefined : { project: "וילה רעננה", category: "חומרים", projectSuggested: true, categorySuggested: true }}
        />
      </div>
      <ActionBar>
        {mismatch ? (
          <>
            <Button full>{SPLIT_MISMATCH_ACTION}</Button>
            <ActionBarRow>
              <div className="ui-review-approve">
                <Button variant="secondary" busy={busy} aria-describedby={REVIEW_MISMATCH_ID}>{SPLIT_MISMATCH_KEEP}</Button>
              </div>
              <Button variant="ghost" disabled={busy}>דלג</Button>
            </ActionBarRow>
          </>
        ) : (
          <>
            <div className="ui-review-approve">
              <Button full busy={busy} disabled={disabled} icon={<CheckIcon />} aria-describedby={disabled ? REVIEW_MISSING_ID : undefined}>
                אישור
              </Button>
            </div>
            <ActionBarRow>
              <Button variant="secondary">שינוי</Button>
              <Button variant="ghost">דלג</Button>
            </ActionBarRow>
          </>
        )}
      </ActionBar>
      {toast ? (
        <div className="ui-toast-host" data-place="bar" ref={host}>
          <Toast action="ביטול" onAction={() => undefined}>{toast}</Toast>
        </div>
      ) : null}
      <TabBar reviewCount={4} />
    </div>
  );
}

const meta = {
  title: "Components/ActionBar",
  component: ReviewWithBar,
  args: { kind: "review" },
} satisfies Meta<typeof ReviewWithBar>;

export default meta;
type Story = StoryObj<typeof meta>;

const dark = { globals: { theme: "dark" } };
const narrow = { parameters: { viewport: { defaultViewport: "flow320" } } };
const se = { parameters: { viewport: { defaultViewport: "flow375-se" } } };

export const Review: Story = {};
export const ReviewSE: Story = { ...se };
export const ReviewBusy: Story = { args: { busy: true } };
export const ReviewDisabled: Story = { args: { disabled: true } };
export const Review320: Story = { ...narrow };
export const ReviewDark: Story = { ...dark };
export const SplitMismatch: Story = { args: { kind: "mismatch" } };
export const SplitMismatch320: Story = { ...narrow, args: { kind: "mismatch" } };
export const SplitMismatchDark: Story = { ...dark, args: { kind: "mismatch" } };
/** Decision 0137: the undo toast sits just above the bar. */
export const ToastAboveBar: Story = { args: { toast: "הפריט אושר" } };
export const ToastAboveBarSE: Story = { ...se, args: { toast: "דילגנו על הפריט" } };
export const ToastAboveBarDark: Story = { ...dark, args: { toast: "הפריט אושר" } };
