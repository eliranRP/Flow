import type { Meta, StoryObj } from "@storybook/react";
import { PromptCard } from "./prompt-card";
import { padded } from "./story-support";

const meta = {
  title: "Components/PromptCard",
  component: PromptCard,
  decorators: [padded],
  args: { question: "התראה על תנועה חדשה ותזכורת בערב?", onYes: () => undefined, onNo: () => undefined },
} satisfies Meta<typeof PromptCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Busy: Story = { args: { busy: true } };
/** An iPhone tab: push needs the app on the Home Screen first (FLOW-502). */
export const HomeScreenNote: Story = { args: { note: "כדי לקבל תזכורות באייפון, מוסיפים את Flow למסך הבית ופותחים משם." } };
