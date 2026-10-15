import type { Meta, StoryObj } from "@storybook/react";
import { SyncStrip } from "./sync-strip";
import { padded } from "./story-support";

const meta = {
  title: "Components/SyncStrip",
  component: SyncStrip,
  decorators: [padded],
} satisfies Meta<typeof SyncStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A background refresh of a bank connection. The pill shows after 200ms; the content stays usable. */
export const Syncing: Story = {
  args: { label: "מסנכרן עם Mercury…" },
};
