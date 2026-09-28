import type { Dashboard, ReviewRow } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react";
import { HelpScreen } from "../screens/HelpScreen";
import { HomeBooks, HomeScreen } from "../screens/HomeScreen";
import { ProjectsScreen, ReviewQueue, ReviewScreen } from "../screens/flow-screens";
import { SignInScreen } from "../screens/SignInScreen";
import { StoryRoute } from "./story-route";

const sampleDashboard: Dashboard = {
  company_id: "story",
  name: "Flow Test",
  vat_registered: true,
  basis: "invoiced",
  from: "2026-09-01",
  to: "2026-09-28",
  income_agorot: 131_000_000,
  direct_agorot: 90_000_000,
  shared_agorot: 0,
  overhead_agorot: 21_000_000,
  expense_agorot: 111_000_000,
  net_profit_agorot: 20_000_000,
  prev_income_agorot: 140_000_000,
  prev_expense_agorot: 118_000_000,
  prev_net_agorot: 22_000_000,
  active_projects: 3,
  review_count: 7,
  projects: [
    { id: "a", name: "בניין מגורים חולון", status: "active", income_agorot: 30_000_000, direct_agorot: 22_000_000, shared_agorot: 0, profit_before_shared_agorot: 8_000_000, profit_agorot: 8_000_000 },
    { id: "b", name: "וילה רעננה", status: "active", income_agorot: 18_000_000, direct_agorot: 13_000_000, shared_agorot: 0, profit_before_shared_agorot: 5_000_000, profit_agorot: 5_000_000 },
    { id: "c", name: "מגדל משרדים פ\"ת", status: "active", income_agorot: 25_000_000, direct_agorot: 21_000_000, shared_agorot: 0, profit_before_shared_agorot: 4_000_000, profit_agorot: 4_000_000 },
  ],
};

const sampleReview: ReviewRow = {
  id: "r1",
  transaction_id: "t1",
  description: "חשבונית חשמל",
  doc_date: "2026-09-21",
  amount_net: -1_200_000,
  direction: "expense",
  reason: "חסר פרויקט",
  project_id: null,
  category_id: null,
  supplier_name: "חברת החשמל",
};

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const HomeEmpty: Story = {
  render: () => (
    <StoryRoute entry="/?preview=empty" tabs>
      <HomeScreen />
    </StoryRoute>
  ),
};

export const HomeLoading: Story = {
  render: () => (
    <StoryRoute entry="/?preview=loading" tabs>
      <HomeScreen />
    </StoryRoute>
  ),
};

export const HomeOffline: Story = {
  render: () => (
    <StoryRoute entry="/?preview=error" tabs>
      <HomeScreen />
    </StoryRoute>
  ),
};

export const HomeServerError: Story = {
  render: () => (
    <StoryRoute entry="/?preview=error-server" tabs>
      <HomeScreen />
    </StoryRoute>
  ),
};

export const SignIn: Story = {
  render: () => (
    <StoryRoute entry="/sign-in">
      <SignInScreen />
    </StoryRoute>
  ),
};

export const SignInFailed: Story = {
  render: () => (
    <StoryRoute entry="/sign-in?error=server_error">
      <SignInScreen />
    </StoryRoute>
  ),
};

export const Help: Story = {
  render: () => (
    <StoryRoute entry="/help">
      <HelpScreen />
    </StoryRoute>
  ),
};

export const ProjectsEmpty: Story = {
  render: () => (
    <StoryRoute entry="/projects?preview=empty" tabs>
      <ProjectsScreen />
    </StoryRoute>
  ),
};

export const ReviewEmpty: Story = {
  render: () => (
    <StoryRoute entry="/review?preview=empty" tabs>
      <ReviewScreen />
    </StoryRoute>
  ),
};

export const HomeBooksMonth: Story = {
  render: () => (
    <StoryRoute entry="/" tabs reviewCount={7}>
      <HomeBooks
        data={sampleDashboard}
        greeting="שלום, אלירן"
        previewing={false}
        search=""
        unpaidNet={2_340_000}
        unpaidCount={3}
        period={{ from: "2026-09-01", to: "2026-09-28", label: "החודש", basis: "invoiced" }}
        onPeriod={() => undefined}
      />
    </StoryRoute>
  ),
};

export const ReviewCardQueue: Story = {
  render: () => (
    <StoryRoute entry="/review" tabs reviewCount={1}>
      <ReviewQueue rows={[sampleReview]} search="" />
    </StoryRoute>
  ),
};

export const SignInCancelled: Story = {
  render: () => (
    <StoryRoute entry="/sign-in?error=access_denied">
      <SignInScreen />
    </StoryRoute>
  ),
};
