import type { CategoryRow, Dashboard, ReviewRow, UnpaidRow } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react";
import { HelpScreen } from "../screens/HelpScreen";
import { HomeBooks, HomeScreen } from "../screens/HomeScreen";
import {
  AddForm,
  CategoriesScreen,
  ChangeForm,
  OnboardingScreen,
  ProjectDetailScreen,
  ProjectsScreen,
  ReviewQueue,
  ReviewScreen,
  SettingsScreen,
  UnpaidScreen,
} from "../screens/flow-screens";
import { SignInScreen } from "../screens/SignInScreen";
import { StoryRoute } from "./story-route";

const sampleDashboard: Dashboard = {
  company_id: "story",
  name: "Flow Test",
  vat_registered: true,
  basis: "invoiced",
  from: "2026-09-01",
  to: "2026-09-28",
  income_agorot: 131_000_000n,
  direct_agorot: 90_000_000n,
  shared_agorot: 0n,
  overhead_agorot: 21_000_000n,
  expense_agorot: 111_000_000n,
  net_profit_agorot: 20_000_000n,
  prev_income_agorot: 140_000_000n,
  prev_expense_agorot: 118_000_000n,
  prev_net_agorot: 22_000_000n,
  active_projects: 3,
  review_count: 7,
  projects: [
    { id: "a", name: "בניין מגורים חולון", status: "active", income_agorot: 30_000_000n, direct_agorot: 22_000_000n, shared_agorot: 0n, profit_before_shared_agorot: 8_000_000n, profit_agorot: 8_000_000n },
    { id: "b", name: "וילה רעננה", status: "active", income_agorot: 18_000_000n, direct_agorot: 13_000_000n, shared_agorot: 0n, profit_before_shared_agorot: 5_000_000n, profit_agorot: 5_000_000n },
    { id: "c", name: "מגדל משרדים פ\"ת", status: "active", income_agorot: 25_000_000n, direct_agorot: 21_000_000n, shared_agorot: 0n, profit_before_shared_agorot: 4_000_000n, profit_agorot: 4_000_000n },
  ],
};

const sampleReview: ReviewRow = {
  id: "r1",
  transaction_id: "t1",
  description: "חשבונית חשמל",
  doc_date: "2026-09-21",
  amount_net: -850_000n,
  vat_agorot: 153_000n,
  direction: "expense",
  reason: null,
  project_id: "a",
  category_id: "c1",
  project_name: "וילה רעננה",
  category_name: "חומרים",
  confidence: 92,
  supplier_name: "חומרי בניין השרון בע״מ",
  auto_approved_today: 12,
};

const sampleUnpaid: UnpaidRow[] = [
  {
    id: "u1",
    description: "חשבונית",
    doc_date: "2026-09-02",
    project_name: "בניין מגורים חולון",
    customer_name: "יזמות הגליל",
    open_gross_agorot: 2_340_000n,
    open_net_agorot: 1_983_051n,
  },
];

const sampleCategories: CategoryRow[] = [
  { id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: true },
  { id: "c2", name: "עבודה", kind: "expense", hidden: true, is_default: true },
];

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
      <p className="ui-page-pad t-hint">נתוני דוגמה · Example data</p>
      <HomeBooks
        data={sampleDashboard}
        greeting="שלום, אלירן"
        previewing={false}
        search=""
        unpaidNet={2_340_000n}
        unpaidCount={3}
        period={{ kind: "month", from: "2026-09-01", to: "2026-09-28" }}
        onPeriod={() => undefined}
      />
    </StoryRoute>
  ),
};

export const ReviewCardQueue: Story = {
  render: () => (
    <StoryRoute entry="/review" tabs reviewCount={1}>
      <p className="ui-page-pad t-hint">נתוני דוגמה · Example data</p>
      <ReviewQueue rows={[sampleReview]} search="" sample />
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

export const ProjectsList: Story = {
  render: () => (
    <StoryRoute entry="/projects" tabs>
      <p className="ui-page-pad t-hint">נתוני דוגמה · Example data</p>
      <ProjectsScreen sample={sampleDashboard} />
    </StoryRoute>
  ),
};

export const ProjectsLoading: Story = {
  render: () => (
    <StoryRoute entry="/projects?preview=loading" tabs>
      <ProjectsScreen />
    </StoryRoute>
  ),
};

export const ProjectsError: Story = {
  render: () => (
    <StoryRoute entry="/projects?preview=error" tabs>
      <ProjectsScreen />
    </StoryRoute>
  ),
};

export const UnpaidList: Story = {
  render: () => (
    <StoryRoute entry="/unpaid">
      <p className="ui-page-pad t-hint">נתוני דוגמה · Example data</p>
      <UnpaidScreen sample={sampleUnpaid} />
    </StoryRoute>
  ),
};

export const UnpaidEmpty: Story = {
  render: () => (
    <StoryRoute entry="/unpaid?preview=empty">
      <UnpaidScreen />
    </StoryRoute>
  ),
};

export const UnpaidError: Story = {
  render: () => (
    <StoryRoute entry="/unpaid?preview=error">
      <UnpaidScreen />
    </StoryRoute>
  ),
};

export const SettingsEmpty: Story = {
  render: () => (
    <StoryRoute entry="/settings?preview=empty">
      <SettingsScreen />
    </StoryRoute>
  ),
};

export const SettingsConnected: Story = {
  render: () => (
    <StoryRoute entry="/settings">
      <p className="ui-page-pad t-hint">נתוני דוגמה · Example data</p>
      <SettingsScreen sample={{ name: "Flow Test", vatRegistered: true, connected: true, companyId: 1001, lastError: "sync_failed" }} />
    </StoryRoute>
  ),
};

export const CategoriesList: Story = {
  render: () => (
    <StoryRoute entry="/settings/categories">
      <p className="ui-page-pad t-hint">נתוני דוגמה · Example data</p>
      <CategoriesScreen sample={sampleCategories} />
    </StoryRoute>
  ),
};

export const Onboarding: Story = {
  render: () => (
    <StoryRoute entry="/onboarding">
      <OnboardingScreen />
    </StoryRoute>
  ),
};

export const HomeLongHero: Story = {
  render: () => (
    <StoryRoute entry="/" tabs>
      <p className="ui-page-pad t-hint">נתוני דוגמה · Example data</p>
      <HomeBooks
        data={{ ...sampleDashboard, income_agorot: 12_345_678_900n, expense_agorot: 0n, net_profit_agorot: 12_345_678_900n }}
        greeting="שלום, אלירן"
        previewing={false}
        search=""
        unpaidNet={0n}
        unpaidCount={0}
        period={{ kind: "all", from: null, to: null }}
        onPeriod={() => undefined}
      />
    </StoryRoute>
  ),
};

export const ProjectDetail: Story = {
  render: () => (
    <StoryRoute entry="/projects/a">
      <p className="ui-page-pad t-hint">נתוני דוגמה · Example data</p>
      <ProjectDetailScreen
        sample={{
          id: "a",
          name: "וילה רעננה",
          status: "active",
          state_label: "פעיל",
          budget_agorot: 5_000_000n,
          income_agorot: 1_800_000n,
          direct_agorot: 900_000n,
          shared_agorot: 0n,
          profit_agorot: 900_000n,
          categories: [{ id: "c1", name: "חומרים", amount_agorot: -900_000n }],
          transactions: [],
        }}
      />
    </StoryRoute>
  ),
};

export const AddSheet: Story = {
  render: () => (
    <StoryRoute entry="/add">
      <AddForm />
    </StoryRoute>
  ),
};

export const ChangeSheet: Story = {
  render: () => (
    <StoryRoute entry="/review/change?item=r1">
      <p className="ui-page-pad t-hint">נתוני דוגמה · Example data</p>
      <ChangeForm
        sample={{
          projects: [{ id: "a", name: "וילה רעננה" }],
          categories: [{ id: "c1", name: "חומרים", hidden: false }],
        }}
      />
    </StoryRoute>
  ),
};
