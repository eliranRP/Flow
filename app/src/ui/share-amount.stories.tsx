import type { Meta, StoryObj } from "@storybook/react";
import { List, ListRow } from "./list-row";
import { ShareAmount } from "./share-amount";

const meta = {
  title: "Components/ShareAmount",
  component: ShareAmount,
} satisfies Meta<typeof ShareAmount>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Alone: Story = { args: { percent: 68, children: <bdi className="ui-num" dir="ltr">$13,450</bdi> } };

/** The loan page's "שולם השנה" rows: the part, its category as the hint, then its share and amount. */
export const InRows: Story = {
  args: { percent: 68, children: null },
  render: () => (
    <List>
      <ListRow variant="button" title="ריבית" hint="ריבית משכנתא" meta={<ShareAmount percent={69}><bdi className="ui-num" dir="ltr">$11,260</bdi></ShareAmount>} chevron onClick={() => undefined} />
      <ListRow variant="button" title="מסים וביטוח" meta={<ShareAmount percent={26}><bdi className="ui-num" dir="ltr">$4,280</bdi></ShareAmount>} chevron onClick={() => undefined} />
      <ListRow variant="button" title="קרן" hint="תשלומי הלוואה" meta={<ShareAmount percent={5}><bdi className="ui-num" dir="ltr">$880</bdi></ShareAmount>} chevron onClick={() => undefined} />
    </List>
  ),
};

/** Nothing paid yet: the amounts read 0 and the percent stays out. */
export const NoShare: Story = { args: { percent: null, children: <bdi className="ui-num" dir="ltr">$0</bdi> } };
