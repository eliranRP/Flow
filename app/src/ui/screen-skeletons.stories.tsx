import type { Meta, StoryObj } from "@storybook/react";
import { DetailSkeleton, LinesSkeleton, LoansSkeleton, ProfitSkeleton, ProjectsSkeleton, RecurringSkeleton } from "./screen-skeletons";
import { padded } from "./story-support";

const meta = {
  title: "Components/Screen skeletons",
  component: LinesSkeleton,
  decorators: [padded],
} satisfies Meta<typeof LinesSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** FLOW-371: month lines loading (board linesLoading). Wired into the month-lines screens in cash-screens.tsx. */
export const MonthLines: Story = { render: () => <LinesSkeleton />, tags: ["clip-no-text"] };

/** FLOW-371: Projects loading (board projectsLoading). Wired into the Projects screen. */
export const Projects: Story = { render: () => <ProjectsSkeleton />, tags: ["clip-no-text"] };

/** FLOW-371: Loans loading (board loansLoading). Wired into the loans section of loan-setup.tsx. */
export const Loans: Story = { render: () => <LoansSkeleton />, tags: ["clip-no-text"] };

/** FLOW-371: קבועים loading (board recurringLoading). Wired into the קבועים list in missing-bill-list.tsx. */
export const Recurring: Story = { render: () => <RecurringSkeleton />, tags: ["clip-no-text"] };

/** FLOW-371: Profit loading (board profitLoading). Wired into the Profit screen's ScreenState. */
export const Profit: Story = { render: () => <ProfitSkeleton />, tags: ["clip-no-text"] };

/** FLOW-371: a transaction page loading (board detailLoading). Wired into the transaction page in transaction-screen.tsx. */
export const Detail: Story = { render: () => <DetailSkeleton />, tags: ["clip-no-text"] };
