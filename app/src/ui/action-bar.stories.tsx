import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActionBar, ActionBarRow } from "./action-bar";
import { Button } from "./button";
import { CheckIcon } from "./icons";
import { ReviewCard, REVIEW_MISMATCH_ID, REVIEW_MISSING_ID, SPLIT_MISMATCH_ACTION, SPLIT_MISMATCH_KEEP } from "./review-card";
import { TabBar } from "./tab-bar";

type BarArgs = {
  kind: "review" | "mismatch";
  busy?: boolean;
  disabled?: boolean;
};

/** FLOW-327: the review card with its bar pinned on the tab bar. Invented data. */
function ReviewWithBar({ kind, busy = false, disabled = false }: BarArgs) {
  const mismatch = kind === "mismatch";
  return (
    <div className="ui-review-queue" data-bar="">
      <header className="ui-page">
        <h1 className="t-total">לאישור</h1>
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
              <Button variant="link" disabled={busy}>דלג</Button>
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
              <Button variant="link">דלג</Button>
            </ActionBarRow>
          </>
        )}
      </ActionBar>
      <TabBar />
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

export const ReviewBusy: Story = { args: { busy: true } };
export const ReviewDisabled: Story = { args: { disabled: true } };
export const SplitMismatch: Story = { args: { kind: "mismatch" } };
