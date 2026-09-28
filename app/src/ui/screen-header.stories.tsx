import type { Meta, StoryObj } from "@storybook/react";
import { PageTitle, ScreenHeader } from "./screen-header";
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
export const LongHebrew: Story = { args: { title: longHebrew, subtitle: longHebrew } };
export const WithBack: Story = {
  args: { title: "חשבוניות פתוחות" },
  render: () => <PageTitle title="חשבוניות פתוחות" backTo="/" />,
};
export const PageLong: Story = {
  args: { title: longHebrew },
  render: () => <PageTitle title={longHebrew} backTo="/" />,
};
