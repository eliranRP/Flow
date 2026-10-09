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

const dark = { globals: { theme: "dark" } };
const at320 = { parameters: { viewport: { defaultViewport: "flow320" } } };

export const Collapsed: Story = {};
export const CollapsedDark: Story = { ...dark };
export const Open: Story = { args: { defaultOpen: true } };
export const OpenDark: Story = { args: { defaultOpen: true }, ...dark };
export const Open320: Story = { args: { defaultOpen: true }, ...at320 };
export const LongLabel320: Story = { args: { label: longHebrew, count: 12 }, ...at320 };
/** No rows: nothing is drawn. */
export const Empty: Story = { args: { count: 0 } };
