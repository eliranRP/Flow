import type { Meta, StoryObj } from "@storybook/react";
import { InviteCard } from "./invite-card";
import { padded } from "./story-support";

/** FLOW-601 (mockups invite-3, invite-4): one invite to the signed-in user. Invented names only. */
const meta = {
  title: "Components/InviteCard",
  component: InviteCard,
  decorators: [padded],
  args: { company: "נכסים לדוגמה בע״מ", line: "עורך · מיוסי כהן", onJoin: () => undefined, onDecline: () => undefined },
} satisfies Meta<typeof InviteCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Joining: Story = { args: { busy: "join" } };
export const Declining: Story = { args: { busy: "decline" } };
export const Waiting: Story = { name: "Another invite is running", args: { disabled: true } };
export const LongName: Story = {
  args: { company: "חברת השקעות ונכסים לדוגמה מהמרכז והשפלה בע״מ", line: "צופה · מאלכסנדרה בן־שושן־רוזנבלום" },
};
export const Dark: Story = { globals: { theme: "dark" } };
export const At320: Story = { ...LongName, name: "320", parameters: { viewport: { defaultViewport: "flow320" } } };
