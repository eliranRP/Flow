import type { Meta, StoryObj } from "@storybook/react";
import { List, ListRow } from "./list-row";
import { ProfitMark } from "./profit-mark";
import { padded } from "./story-support";

/** Home's project rows (profit by period, plan §2): the mark under the name, the period's profit at the end. */
function Rows() {
  return (
    <List>
      <ListRow variant="project" title="שיפוץ משרדים לדוגמה" hint={<ProfitMark loss />} agorot={-965_000n} loss />
      <ListRow variant="project" title="וילה לדוגמה" hint={<ProfitMark loss={false} />} agorot={10_060_000n} loss={false} />
      <ListRow
        variant="project"
        title="פרויקט בשני מטבעות לדוגמה"
        hint={<ProfitMark loss={false} />}
        agorot={3_190_000n}
        amounts={[{ minor: 3_190_000n, currency: "ILS" }, { minor: -120_000n, currency: "USD" }]}
        loss={false}
      />
    </List>
  );
}

const meta = {
  title: "Components/ProfitMark",
  component: ProfitMark,
  decorators: [padded],
} satisfies Meta<typeof ProfitMark>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Profit: Story = { args: { loss: false } };
export const Loss: Story = { args: { loss: true } };
export const LossDark: Story = { args: { loss: true }, name: "Loss, dark", globals: { theme: "dark" } };
export const ProjectRows: Story = { args: { loss: false }, render: () => <Rows /> };
export const ProjectRowsDark: Story = { args: { loss: false }, name: "Project rows, dark", render: () => <Rows />, globals: { theme: "dark" } };
export const ProjectRows320: Story = {
  args: { loss: false },
  name: "Project rows, 320",
  render: () => <Rows />,
  parameters: { viewport: { defaultViewport: "flow320" } },
};
