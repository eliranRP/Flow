import type { Meta, StoryObj } from "@storybook/react";
import { PromptCard } from "./prompt-card";
import { at320, dark } from "./screen-stories-support";
import { padded } from "./story-support";

const meta = {
  title: "Components/PromptCard",
  component: PromptCard,
  decorators: [padded],
  args: { question: "תזכורת בערב כשיש תנועות לאישור?", onYes: () => undefined, onNo: () => undefined },
} satisfies Meta<typeof PromptCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Default320: Story = { ...at320 };
export const DefaultDark320: Story = { ...at320, ...dark };
export const Busy: Story = { args: { busy: true } };
/** An iPhone tab: push needs the app on the Home Screen first (FLOW-502). */
export const HomeScreenNote: Story = { args: { note: "כדי לקבל תזכורות באייפון, מוסיפים את Flow למסך הבית ופותחים משם." } };
export const HomeScreenNote320: Story = { args: { note: "כדי לקבל תזכורות באייפון, מוסיפים את Flow למסך הבית ופותחים משם." }, ...at320 };
export const HomeScreenNoteDark320: Story = { args: { note: "כדי לקבל תזכורות באייפון, מוסיפים את Flow למסך הבית ופותחים משם." }, ...at320, ...dark };
