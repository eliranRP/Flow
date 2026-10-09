import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./button";
import { EmptyState } from "./empty-state";
import { ChartIcon, LoanIcon, PlusIcon } from "./icons";
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
    body: "הרווח יופיע כאן אחרי חיבור בנק או SUMIT.",
    action: (
      <Button variant="pill" to="/settings/connections">
        חיבור בנק או SUMIT
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
/** FLOW-501: the Loans page with no loans. The owner gets one primary action. */
export const Loans: Story = {
  args: {
    icon: <LoanIcon />,
    title: "אין הלוואות עדיין",
    body: "הוסיפו הלוואה כדי לפצל כל תשלום לריבית, מסים וביטוח וקרן.",
    action: (
      <Button variant="pill" icon={<PlusIcon />}>
        הלוואה חדשה
      </Button>
    ),
  },
};
/** A viewer reads the page and cannot add. */
export const LoansViewer: Story = {
  args: {
    icon: <LoanIcon />,
    title: "אין הלוואות עדיין",
    body: "כשיתווספו הלוואות הן יופיעו כאן.",
  },
};
export const LongHebrew: Story = {
  args: {
    icon: <ChartIcon />,
    title: longHebrew,
    body: longHebrew,
    action: (
      <Button variant="pill" to="/settings">
        {longHebrew}
      </Button>
    ),
  },
};

/** FLOW-334: Home's empty action beside the error retry: both the 44px tint button, dark and 320. */
export const DefaultDark: Story = { args: Default.args, globals: { theme: "dark" } };
export const Default320: Story = { args: Default.args, parameters: { viewport: { defaultViewport: "flow320" } } };
