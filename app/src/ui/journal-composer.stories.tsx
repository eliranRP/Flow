import type { Meta, StoryObj } from "@storybook/react-vite";
import { SAMPLE_COMPOSER_ACCOUNTS } from "../dev/journal-composer-sample";
import { AccountPickSheet, ComposerAddLeg, ComposerBankLeg, ComposerLegCard, ComposerStart, ComposerStatus, CopySheet } from "./journal-composer";
import { padded } from "./story-support";

/** FLOW-955. The composer's parts one by one (board LedgerComposer). Invented data only. */
const meta = {
  title: "Components/JournalComposer",
  decorators: [padded],
} satisfies Meta;

export default meta;
type Story = StoryObj;

const noop = () => undefined;

/** Where the entry starts: Jev's suggestion picked, its note, and התחלה מאפס. */
export const StartJev: Story = {
  render: () => <ComposerStart value="jev" jev copy note="✦ הצעה של Jev · על בסיס 3 תנועות קודמות של Example Lending" onJev={noop} onCopy={noop} onClear={noop} />,
};

/** Free editing with no suggestion: Jev's start is off, the copy start stays. */
export const StartFreeNoJev: Story = {
  render: () => <ComposerStart value="free" jev={false} copy note="עריכה חופשית" onJev={noop} onCopy={noop} onClear={noop} />,
};

/** The balance line in each of its states. */
export const Statuses: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <ComposerStatus hold={{ kind: "balanced", total: 20_600_000n }} currency="USD" />
      <ComposerStatus hold={{ kind: "short", side: "credit", minor: 600_000n }} currency="USD" />
      <ComposerStatus hold={{ kind: "short", side: "debit", minor: 12_345n }} currency="USD" />
      <ComposerStatus hold={{ kind: "incomplete" }} currency="USD" />
      <ComposerStatus hold={{ kind: "single", total: 20_000_000n }} currency="USD" />
    </div>
  ),
};

/** שורה 1, the bank line, read only; a long account name keeps its last 4. */
export const BankLeg: Story = {
  render: () => <ComposerBankLeg name="Example Business Checking Account ••1234" side="debit" amount={20_000_000n} currency="USD" />,
};

/** An editable line: account, project, amount and side, and "+ שורה נוספת" under it. */
export const LegCards: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <ComposerLegCard index={2} account="עלויות סגירה" project="פרויקט הרצליה" amount="6000" side="debit" note="הוצאה · נספר ברווח" onAccount={noop} onProject={noop} onAmount={noop} onSide={noop} onRemove={noop} />
      <ComposerLegCard index={3} account={null} project={null} amount="" side="credit" note="בחרו חשבון" onAccount={noop} onProject={noop} onAmount={noop} onSide={noop} onRemove={noop} />
      <ComposerAddLeg onAdd={noop} />
    </div>
  ),
};

/** The account picker: the bookable accounts by type, the kept-out ones say so. */
export const AccountPicker: Story = {
  render: () => <AccountPickSheet open onOpenChange={noop} title="חשבון · שורה 2" accounts={SAMPLE_COMPOSER_ACCOUNTS} selectedId="a-closing" onPick={noop} />,
};

/** כמו תנועה קודמת, with one line picked. */
export const CopyPicker: Story = {
  render: () => (
    <CopySheet
      open
      onOpenChange={noop}
      party="Example Lending"
      selectedId="t-1"
      onPick={noop}
      options={[
        { id: "t-1", title: "Example Lending · 02/08", amount: "+$150,000", income: false, debit: ["בנק $150,000", "עלויות סגירה $4,500"], credit: ["הלוואה · Example $154,500"] },
        { id: "t-2", title: "Example Lending · 11/05", amount: "+$180,000", income: false, debit: ["בנק $180,000", "עלויות סגירה $5,400"], credit: ["הלוואה · Example $185,400"] },
      ]}
    />
  ),
};
