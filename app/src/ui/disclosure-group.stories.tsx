import type { Meta, StoryObj } from "@storybook/react";
import { BankIcon } from "./icons";
import { DisclosureGroup } from "./disclosure-group";
import { List, ListRow } from "./list-row";
import { longHebrew } from "./story-support";

/** FLOW-106. A quiet "label (N)" that shows the rows under it. Invented loans. */
function Rows() {
  return (
    <List>
      <ListRow variant="button" title="שטר ישן" hint="נפרעה · 15/06/2026" icon={<BankIcon />} muted tone="muted" chevron onClick={() => undefined} />
      <ListRow variant="button" title="הלוואת ציוד ישנה" hint="נסגרה · 30/11/2025" icon={<BankIcon />} muted tone="muted" chevron onClick={() => undefined} />
    </List>
  );
}

const meta = {
  title: "Components/DisclosureGroup",
  component: DisclosureGroup,
  args: { label: "נסגרו", count: 2, children: <Rows /> },
} satisfies Meta<typeof DisclosureGroup>;

export default meta;
type Story = StoryObj<typeof meta>;


export const Collapsed: Story = {};
export const Open: Story = { args: { defaultOpen: true } };
export const LongLabel: Story = { args: { label: longHebrew, count: 12 } };
/** No rows: nothing is drawn. */
export const Empty: Story = { args: { count: 0 } };
