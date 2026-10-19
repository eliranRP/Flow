import type { Meta, StoryObj } from "@storybook/react";
import { LinesSkeleton, LoansSkeleton, ProfitRowsSkeleton, ProfitSkeleton, ProjectsSkeleton, RecurringSkeleton } from "./screen-skeletons";
import { padded } from "./story-support";

const meta = {
  title: "Components/Screen skeletons",
  component: LinesSkeleton,
  decorators: [padded],
} satisfies Meta<typeof LinesSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** FLOW-371: month lines loading (board linesLoading). Wired into the month-lines screen in cash-lines-screen.tsx. */
export const MonthLines: Story = { render: () => <LinesSkeleton />, tags: ["clip-no-text"] };

/** FLOW-371: Projects loading (board projectsLoading). Wired into the Projects screen. */
export const Projects: Story = { render: () => <ProjectsSkeleton />, tags: ["clip-no-text"] };

/** FLOW-371: Loans loading (board loansLoading). Wired into the loans section of loan-setup.tsx. */
export const Loans: Story = { render: () => <LoansSkeleton />, tags: ["clip-no-text"] };

/** FLOW-371: קבועים loading (board recurringLoading). Wired into the קבועים list (screens/recurring-screen.tsx). */
export const Recurring: Story = { render: () => <RecurringSkeleton />, tags: ["clip-no-text"] };

/** FLOW-371: Profit loading (board profitLoading). Wired into the Profit screen's ScreenState. */
export const Profit: Story = { render: () => <ProfitSkeleton />, tags: ["clip-no-text"] };
export const ProfitRows: Story = { render: () => <ProfitRowsSkeleton />, tags: ["clip-no-text"] };
