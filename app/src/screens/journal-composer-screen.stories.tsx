import type { Meta, StoryObj } from "@storybook/react";
import {
  SAMPLE_BALANCED_START,
  SAMPLE_COMPOSER_ACCOUNTS,
  SAMPLE_COMPOSER_PROJECTS,
  SAMPLE_COPIES,
  SAMPLE_COPY_START,
  SAMPLE_JEV_START,
  SAMPLE_LOAN_LINE,
  SAMPLE_MORTGAGE_LINE,
  SAMPLE_MORTGAGE_START,
  SAMPLE_SCRATCH_START,
  SAMPLE_SUGGESTION,
  SAMPLE_UNBALANCED_START,
  sampleComposerApi,
} from "../dev/journal-composer-sample";
import { composerRefusal } from "../line-composer";
import { StoryRoute } from "../ui/story-route";
import { JournalComposerScreen, type JournalComposerSample } from "./journal-composer-screen";

/**
 * FLOW-955 (board LedgerComposer, LedgerComposerTemplates). Every state comes from props; no play types or
 * focuses, so the layout checks keep the page as it opens. Invented data only.
 */
const meta = {
  title: "Screens/Journal composer",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Composer(props: Partial<JournalComposerSample>) {
  const line = props.line ?? SAMPLE_LOAN_LINE;
  return (
    <StoryRoute entry={`/transactions/${line.id}/journal`}>
      <JournalComposerScreen
        sample={{
          line,
          accounts: SAMPLE_COMPOSER_ACCOUNTS,
          projects: SAMPLE_COMPOSER_PROJECTS,
          suggestion: SAMPLE_SUGGESTION,
          copies: SAMPLE_COPIES,
          initial: SAMPLE_JEV_START,
          api: sampleComposerApi(),
          ...props,
        }}
      />
    </StoryRoute>
  );
}

/** ✦ הצעה של Jev: the loan less closing costs, from three earlier loans, balanced and ready to save. */
export const FromJev: Story = { render: () => <Composer /> };

/** כמו תנועה קודמת: copied from the loan of 02/08, its amounts scaled to this line. */
export const FromCopy: Story = { render: () => <Composer initial={SAMPLE_COPY_START} /> };

/** התחלה מאפס: one empty line; save waits for an account and an amount. */
export const FromScratch: Story = { render: () => <Composer initial={SAMPLE_SCRATCH_START} /> };

/** The credits are short: "חסרים $6,000 בזכות", and save stays off. */
export const Unbalanced: Story = { render: () => <Composer initial={SAMPLE_UNBALANCED_START} /> };

/** Three lines that balance: "מאוזן · $206,500 בחובה ובזכות". */
export const Balanced: Story = { render: () => <Composer initial={SAMPLE_BALANCED_START} /> };

/** A mortgage payment out: the bank on the credit side, interest counted, escrow and principal kept out. */
export const PaymentOut: Story = {
  render: () => <Composer line={SAMPLE_MORTGAGE_LINE} suggestion={null} copies={null} initial={SAMPLE_MORTGAGE_START} />,
};

/** The save is on its way: the lines and starts wait. */
export const Saving: Story = { render: () => <Composer saving /> };

/** The server refused the save: the reason above the button, the entry kept as it was. */
export const SaveError: Story = { render: () => <Composer error={composerRefusal("line has an open review")} /> };

/** The copy sheet: the party's booked lines, each with its חובה and זכות. */
export const CopySheet: Story = { render: () => <Composer sheet /> };

/** No history for this party: no starts to pick, the line as booked (one line), and the hint to add another. */
export const NoHistory: Story = {
  render: () => (
    <Composer
      suggestion={null}
      copies={null}
      initial={{ start: "free", legs: [{ key: "one", accountId: "a-sales", projectId: "p-herz", side: "credit", amount: "200000" }], copied: null }}
    />
  ),
};
