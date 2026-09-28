import type { Meta, StoryObj } from "@storybook/react";
import { ScreenHeader } from "./screen-header";
import { longHebrew, padded } from "./story-support";

const meta = {
  title: "Components/ScreenHeader",
  component: ScreenHeader,
  decorators: [padded],
} satisfies Meta<typeof ScreenHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { title: "עזרה", subtitle: "לעזרה בכניסה כותבים לנו." } };
export const TitleOnly: Story = { args: { title: "הגדרות" } };
export const WithBack: Story = { args: { title: "חשבוניות שלא שולמו", backTo: "/" } };
export const LongHebrew: Story = { args: { title: longHebrew, subtitle: longHebrew, backTo: "/" } };
