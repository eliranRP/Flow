import type { Meta, StoryObj } from "@storybook/react";
import { IconButton } from "./icon-button";
import { BackIcon, MoreIcon } from "./icons";
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
export const Compact: Story = {
  args: { title: "הוצאה", size: "compact" },
  render: () => (
    <ScreenHeader
      title="הוצאה"
      size="compact"
      leading={<IconButton label="חזרה" to="/"><BackIcon /></IconButton>}
      trailing={<IconButton label="עוד" onClick={() => undefined}><MoreIcon /></IconButton>}
    />
  ),
};
