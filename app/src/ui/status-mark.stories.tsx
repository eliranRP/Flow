import type { Meta, StoryObj } from "@storybook/react-vite";
import { List, ListRow } from "./list-row";
import { StatusMark } from "./status-mark";
import { padded } from "./story-support";

/** FLOW-1043: the status marks as ListRow icons. The row's own words say the state; shape tells the marks apart. Invented rows. */
const meta = {
  title: "Components/StatusMark",
  component: StatusMark,
  decorators: [padded],
  args: { kind: "due" },
  argTypes: { kind: { control: "select", options: ["due", "late", "paid", "once"] } },
} satisfies Meta<typeof StatusMark>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Single: Story = {};

export const OnRows: Story = {
  render: () => (
    <List>
      <ListRow variant="static" title="חדר כושר · הולמס פלייס" hint="איחר · בדרך כלל ב-3" icon={<StatusMark kind="late" />} />
      <ListRow variant="static" title="ארנונה · עירייה" hint="צפוי ב-15" icon={<StatusMark kind="due" />} />
      <ListRow variant="static" title="אינטרנט · בזק" hint="2 בנוב׳ · שולם" icon={<StatusMark kind="paid" />} />
      <ListRow variant="static" title="סופר · רמי לוי" hint="3 בנוב׳ · חד-פעמי" icon={<StatusMark kind="once" />} />
    </List>
  ),
};
