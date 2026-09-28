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
  SplitScreen,
  TransactionScreen,
  UnpaidScreen,
} from "../screens/flow-screens";
import { SignInScreen } from "../screens/SignInScreen";
import {
  InstallAndroidFrame,
  InstallIphoneFrame,
  InvoiceReadingFrame,
  NotificationsLockFrame,
  OfflineCachedFrame,
  PullToRefreshFrame,
  UploadProcessingFrame,
} from "./reference-frames.stories-support";
import { StoryRoute } from "./story-route";
import { TabBar } from "./tab-bar";

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
    description: "הובלה",
    doc_date: "2026-09-02",
    project_name: "שיפוץ דירה ת\"א",
    customer_name: "מ.ש. הובלות",
    open_gross_agorot: 600_000n,
    open_net_agorot: 508_475n,
  },
  {
    id: "u2",
    description: "חשמל",
    doc_date: "2026-09-10",
    project_name: "וילה רעננה",
    customer_name: "אבי חשמל",
    open_gross_agorot: 800_000n,
    open_net_agorot: 677_966n,
  },
  {
    id: "u3",
    description: "חומרים",
    doc_date: "2026-09-14",
    project_name: "בניין מגורים חולון",
    customer_name: "חומרי בניין השרון",
    open_gross_agorot: 940_000n,
    open_net_agorot: 796_610n,
  },
];

const sampleCategories: Array<CategoryRow & { count?: number }> = [
  { id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: true, count: 42 },
  { id: "c2", name: "ציוד והשכרה", kind: "expense", hidden: false, is_default: true, count: 8 },
  { id: "c3", name: "הובלה", kind: "expense", hidden: false, is_default: true, count: 5 },
  { id: "c4", name: "עבודה", kind: "expense", hidden: true, is_default: true, count: 1 },
  { id: "c5", name: "תקבול", kind: "income", hidden: false, is_default: true, count: 3 },
];

function listedProject(id: string, name: string, status: "active" | "finished" = "active"): Dashboard["projects"][number] {
  return {
    id,
    name,
    status,
    income_agorot: 10_000_000n,
    direct_agorot: 8_000_000n,
    shared_agorot: 0n,
    profit_before_shared_agorot: 2_000_000n,
    profit_agorot: 2_000_000n,
  };
}

const projectsList: Dashboard = {
  ...sampleDashboard,
  projects: [
    listedProject("a", "בניין מגורים חולון"),
    listedProject("b", "וילה רעננה"),
    listedProject("c", "מגדל משרדים פ\"ת"),
    ...Array.from({ length: 14 }, (_, index) => listedProject(`p${String(index)}`, `פרויקט ${String(index + 4)}`)),
    ...Array.from({ length: 21 }, (_, index) => listedProject(`f${String(index)}`, `הסתיים ${String(index + 1)}`, "finished")),
  ],
};

const exampleLabel = "נתוני דוגמה · Example data";

function ExampleBar() {
  return <p className="ui-example-bar t-hint">{exampleLabel}</p>;
}

const exampleOnBand = <span className="ui-example t-hint">{exampleLabel}</span>;

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const HomeEmpty: Story = {
  render: () => (
    <StoryRoute entry="/?preview=empty" tabs>
      <HomeScreen example={exampleOnBand} />
    </StoryRoute>
  ),
};

export const HomeLoading: Story = {
  render: () => (
    <StoryRoute entry="/?preview=loading" tabs>
      <HomeScreen example={exampleOnBand} />
    </StoryRoute>
  ),
};

export const HomeOffline: Story = {
  render: () => (
    <StoryRoute entry="/?preview=error" tabs>
      <ExampleBar />
      <HomeScreen />
    </StoryRoute>
  ),
};

export const HomeServerError: Story = {
  render: () => (
    <StoryRoute entry="/?preview=error-server" tabs>
      <ExampleBar />
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
      <ExampleBar />
      <ProjectsScreen />
    </StoryRoute>
  ),
};

export const ReviewEmpty: Story = {
  render: () => (
    <StoryRoute entry="/review?preview=empty" tabs>
      <ExampleBar />
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
        unpaidGross={2_340_000n}
        unpaidCount={3}
        period={{ kind: "month", from: "2026-09-01", to: "2026-09-28" }}
        onPeriod={() => undefined}
        example={exampleOnBand}
      />
    </StoryRoute>
  ),
};

export const ReviewCardQueue: Story = {
  render: () => (
    <StoryRoute entry="/review" tabs reviewCount={1}>
      <ExampleBar />
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
      <ExampleBar />
      <ProjectsScreen sample={projectsList} />
    </StoryRoute>
  ),
};

export const ProjectsLoading: Story = {
  render: () => (
    <StoryRoute entry="/projects?preview=loading" tabs>
      <ExampleBar />
      <ProjectsScreen />
    </StoryRoute>
  ),
};

export const ProjectsError: Story = {
  render: () => (
    <StoryRoute entry="/projects?preview=error" tabs>
      <ExampleBar />
      <ProjectsScreen />
    </StoryRoute>
  ),
};

export const UnpaidList: Story = {
  render: () => (
    <StoryRoute entry="/unpaid" tabs>
      <ExampleBar />
      <UnpaidScreen sample={sampleUnpaid} />
    </StoryRoute>
  ),
};

export const UnpaidEmpty: Story = {
  render: () => (
    <StoryRoute entry="/unpaid?preview=empty" tabs>
      <ExampleBar />
      <UnpaidScreen />
    </StoryRoute>
  ),
};

export const UnpaidError: Story = {
  render: () => (
    <StoryRoute entry="/unpaid?preview=error" tabs>
      <ExampleBar />
      <UnpaidScreen />
    </StoryRoute>
  ),
};

export const SettingsEmpty: Story = {
  render: () => (
    <StoryRoute entry="/settings?preview=empty" tabs>
      <ExampleBar />
      <SettingsScreen />
    </StoryRoute>
  ),
};

export const SettingsConnected: Story = {
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <SettingsScreen
        sample={{
          name: "א.ב. בנייה ושיפוצים בע״מ",
          vatRegistered: true,
          connected: true,
          companyId: 1001,
          lastError: null,
          email: "ops@nromomentum.com",
          projectCount: 17,
          expenseCategories: 7,
          incomeCategories: 2,
        }}
      />
    </StoryRoute>
  ),
};

export const SettingsError: Story = {
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <SettingsScreen
        sample={{
          name: "א.ב. בנייה ושיפוצים בע״מ",
          vatRegistered: true,
          connected: true,
          companyId: 1001,
          lastError: "sync_failed",
          email: "ops@nromomentum.com",
        }}
      />
    </StoryRoute>
  ),
};

export const CategoriesList: Story = {
  render: () => (
    <StoryRoute entry="/settings/categories" tabs>
      <ExampleBar />
      <CategoriesScreen sample={sampleCategories} />
    </StoryRoute>
  ),
};

export const Onboarding: Story = {
  render: () => (
    <StoryRoute entry="/onboarding">
      <ExampleBar />
      <OnboardingScreen />
    </StoryRoute>
  ),
};

export const HomeLongHero: Story = {
  render: () => (
    <StoryRoute entry="/" tabs>
      <HomeBooks
        data={{ ...sampleDashboard, income_agorot: 12_345_678_900n, expense_agorot: 0n, net_profit_agorot: 12_345_678_900n }}
        greeting="שלום, אלירן"
        previewing={false}
        search=""
        unpaidGross={0n}
        unpaidCount={0}
        period={{ kind: "all", from: null, to: null }}
        onPeriod={() => undefined}
        example={exampleOnBand}
      />
    </StoryRoute>
  ),
};

export const ProjectDetail: Story = {
  render: () => (
    <StoryRoute entry="/projects/a" tabs>
      <ProjectDetailScreen
        example={exampleOnBand}
        sample={{
          id: "a",
          name: "וילה רעננה",
          status: "active",
          state_label: "משפ׳ כהן · מתחילת הפרויקט",
          budget_agorot: 100_000_000n,
          income_agorot: 90_000_000n,
          direct_agorot: 72_000_000n,
          shared_agorot: 0n,
          profit_agorot: 18_000_000n,
          categories: [
            { id: "c1", name: "חומרים", amount_agorot: 30_000_000n },
            { id: "c2", name: "קבלני משנה", amount_agorot: 22_000_000n },
            { id: "c3", name: "עבודה", amount_agorot: 12_000_000n },
          ],
          transactions: [
            {
              id: "t1",
              description: "חומרי בניין השרון",
              doc_date: "2026-09-14",
              amount_net: -8_500_000n,
              direction: "expense",
              category: "חומרים",
            },
          ],
        }}
      />
    </StoryRoute>
  ),
};

export const AddSheet: Story = {
  render: () => (
    <StoryRoute entry="/add">
      <ExampleBar />
      <AddForm />
    </StoryRoute>
  ),
};

export const ReviewLoading: Story = {
  render: () => (
    <StoryRoute entry="/review?preview=loading" tabs>
      <ExampleBar />
      <ReviewScreen />
    </StoryRoute>
  ),
};

export const ReviewError: Story = {
  render: () => (
    <StoryRoute entry="/review?preview=error" tabs>
      <ExampleBar />
      <ReviewScreen />
    </StoryRoute>
  ),
};

export const ProjectDetailLoading: Story = {
  render: () => (
    <StoryRoute entry="/projects/a?preview=loading" tabs>
      <ProjectDetailScreen example={exampleOnBand} />
    </StoryRoute>
  ),
};

export const ProjectDetailError: Story = {
  render: () => (
    <StoryRoute entry="/projects/a?preview=error" tabs>
      <ExampleBar />
      <ProjectDetailScreen />
    </StoryRoute>
  ),
};

export const CategoriesEmpty: Story = {
  render: () => (
    <StoryRoute entry="/settings/categories?preview=empty" tabs>
      <ExampleBar />
      <CategoriesScreen />
    </StoryRoute>
  ),
};

export const CategoriesError: Story = {
  render: () => (
    <StoryRoute entry="/settings/categories?preview=error" tabs>
      <ExampleBar />
      <CategoriesScreen />
    </StoryRoute>
  ),
};

export const Transaction: Story = {
  render: () => (
    <StoryRoute entry="/transactions/t1">
      <ExampleBar />
      <TransactionScreen
        sample={{
          id: "t1",
          description: "חשבונית חומרים",
          direction: "expense",
          doc_date: "2026-09-21",
          amount_gross: -1_003_000n,
          amount_net: -850_000n,
          vat_amount: -153_000n,
          vat_status: "source",
          doc_kind: "invoice",
          source: "sumit",
          project_id: "holon",
          project_name: "בניין מגורים חולון",
          category_id: "c1",
          category_name: "חומרים",
          supplier_name: "חומרי בניין השרון בע״מ",
          customer_name: null,
          review_status: "approved",
          paid: true,
          open_gross_agorot: null,
        }}
        sampleProjects={[
          { id: "holon", name: "בניין מגורים חולון", code: "P-14" },
          { id: "villa", name: "וילה רעננה", code: "P-02" },
        ]}
        sampleCategories={[
          { id: "c1", name: "חומרים" },
          { id: "c2", name: "ציוד והשכרה" },
          { id: "c3", name: "הובלה" },
        ]}
      />
    </StoryRoute>
  ),
};

export const Split: Story = {
  render: () => (
    <StoryRoute entry="/transactions/t1/split">
      <ExampleBar />
      <SplitScreen
        sampleContext="משכורת עובדי שטח · ספטמבר · עבודה"
        sampleAmount={3_600_000n}
        sampleProjects={[
          { id: "a", name: "בניין מגורים חולון", incomeAgorot: 20_000_000n },
          { id: "b", name: "מגדל משרדים פ\"ת", incomeAgorot: 15_000_000n },
          { id: "c", name: "וילה רעננה", incomeAgorot: 10_000_000n },
          { id: "d", name: "בית פרטי כפר סבא", incomeAgorot: 5_000_000n },
        ]}
      />
    </StoryRoute>
  ),
};

export const ChangeSheet: Story = {
  render: () => (
    <StoryRoute entry="/review/change?item=r1">
      <ExampleBar />
      <ChangeForm
        sample={{
          supplier: "חומרי בניין השרון",
          amount: "₪8,500",
          suggestionId: "holon",
          recentId: "villa",
          categoryId: "c1",
          projects: [
            { id: "holon", name: "בניין מגורים חולון", code: "P-14" },
            { id: "villa", name: "וילה רעננה", code: "P-02" },
            { id: "p14", name: "מגדל משרדים פ\"ת", code: "P-14", hint: "היום" },
            { id: "p21", name: "בית פרטי כפר סבא", code: "P-21", hint: "לפני 3 ימים" },
            { id: "p03", name: "שיפוץ דירה ת\"א", code: "P-03", hint: "לפני שבוע" },
          ],
          categories: [
            { id: "c1", name: "חומרים", hidden: false, kind: "expense" },
            { id: "c2", name: "ציוד והשכרה", hidden: false, kind: "expense" },
            { id: "c3", name: "הובלה", hidden: false, kind: "expense" },
            { id: "c4", name: "עבודה", hidden: false, kind: "expense" },
          ],
        }}
      />
    </StoryRoute>
  ),
};

export const InstallAndroid: Story = {
  render: () => (
    <StoryRoute entry="/">
      <ExampleBar />
      <InstallAndroidFrame />
    </StoryRoute>
  ),
};

export const InstallIphone: Story = {
  render: () => (
    <StoryRoute entry="/">
      <ExampleBar />
      <InstallIphoneFrame />
    </StoryRoute>
  ),
};

export const UploadProcessing: Story = {
  render: () => (
    <StoryRoute entry="/">
      <ExampleBar />
      <UploadProcessingFrame />
    </StoryRoute>
  ),
};

export const InvoiceReading: Story = {
  render: () => (
    <StoryRoute entry="/">
      <ExampleBar />
      <InvoiceReadingFrame />
    </StoryRoute>
  ),
};

export const PullToRefresh: Story = {
  render: () => (
    <StoryRoute entry="/" tabs>
      <ExampleBar />
      <PullToRefreshFrame />
    </StoryRoute>
  ),
};

export const OfflineCached: Story = {
  render: () => (
    <StoryRoute entry="/" tabs>
      <ExampleBar />
      <OfflineCachedFrame />
    </StoryRoute>
  ),
};

export const NotificationsLock: Story = {
  render: () => (
    <StoryRoute entry="/">
      <ExampleBar />
      <NotificationsLockFrame />
    </StoryRoute>
  ),
};

export const FabPressed: Story = {
  render: () => (
    <StoryRoute entry="/">
      <div className="flex min-h-dvh flex-1 flex-col justify-end">
        <TabBar fabPressed />
      </div>
    </StoryRoute>
  ),
};
