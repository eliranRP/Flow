import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./button";
import { EmptyState } from "./empty-state";
import { ChartIcon } from "./icons";
import { longHebrew, padded } from "./story-support";

const meta = {
  title: "Components/EmptyState",
  component: EmptyState,
  decorators: [padded],
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    icon: <ChartIcon />,
    title: "עוד אין נתונים",
    body: "הרווח יופיע כאן אחרי ש-SUMIT מחובר.",
    action: (
      <Button variant="secondary" to="/settings">
        חיבור SUMIT
      </Button>
    ),
  },
};
export const WithoutAction: Story = {
  args: {
    icon: <ChartIcon />,
    title: "אין פריטים לאישור",
    body: "כשחסר פרויקט או קטגוריה, הפריט מופיע כאן.",
  },
};
export const LongHebrew: Story = {
  args: {
    icon: <ChartIcon />,
    title: longHebrew,
    body: longHebrew,
    action: (
      <Button variant="secondary" to="/settings">
        {longHebrew}
      </Button>
    ),
  },
};
