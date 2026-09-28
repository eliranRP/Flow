import type { CategoryRow, Dashboard, ReviewRow, UnpaidRow } from "@flow/shared";
import type { ReactNode } from "react";
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
import { Banner } from "./banner";
import { OfflineIcon } from "./icons";
import { TextLink } from "./text-link";
import { InstallScreen } from "./install-screen";
import {
  InvoiceReadingFrame,
  NotificationsLockFrame,
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

export const SettingsBackoff: Story = {
  name: "Backoff",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <SettingsScreen
        sample={{
          name: "א.ב. בנייה ושיפוצים בע״מ",
          vatRegistered: true,
          connected: true,
          companyId: 1001,
          lastError: "sumit_rejected",
          nextAttemptAt: "2099-01-01T10:00:00.000Z",
          email: "ops@nromomentum.com",
        }}
      />
    </StoryRoute>
  ),
};

export const SettingsAuth: Story = {
  name: "Auth",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <SettingsScreen
        sample={{
          name: "א.ב. בנייה ושיפוצים בע״מ",
          vatRegistered: true,
          connected: true,
          companyId: 1001,
          lastError: "sumit_auth",
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

export const CategoriesHiddenCollapsed: Story = {
  render: () => (
    <StoryRoute entry="/settings/categories" tabs>
      <ExampleBar />
      <CategoriesScreen sample={sampleCategories} />
    </StoryRoute>
  ),
};

export const CategoriesHiddenExpanded: Story = {
  render: () => (
    <StoryRoute entry="/settings/categories" tabs>
      <ExampleBar />
      <CategoriesScreen sample={sampleCategories} hiddenOpen />
    </StoryRoute>
  ),
};

export const CategoriesNoneHidden: Story = {
  render: () => (
    <StoryRoute entry="/settings/categories" tabs>
      <ExampleBar />
      <CategoriesScreen sample={sampleCategories.filter((category) => !category.hidden)} />
    </StoryRoute>
  ),
};

const longHebrewCategories: Array<CategoryRow & { count?: number }> = [
  {
    id: "c1",
    name: "חומרי בניין וציוד השכרה לקבלני משנה באתר הוילה",
    kind: "expense",
    hidden: false,
    is_default: false,
    count: 124,
  },
  {
    id: "c2",
    name: "עבודות גמר ושיפוץ פנים כולל חשמל ואינסטלציה מלאה",
    kind: "expense",
    hidden: true,
    is_default: false,
    count: 52,
  },
];

export const CategoriesLongHebrew: Story = {
  parameters: { viewport: { defaultViewport: "flow320" } },
  render: () => (
    <StoryRoute entry="/settings/categories" tabs>
      <ExampleBar />
      <CategoriesScreen sample={longHebrewCategories} />
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
  parameters: { viewport: { defaultViewport: "flow390-short" } },
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

export const TransactionShared: Story = {
  name: "Shared",
  render: () => (
    <StoryRoute entry="/transactions/t1">
      <ExampleBar />
      <TransactionScreen
        sample={{
          id: "t1",
          description: "משכורת עובדי שטח",
          direction: "expense",
          doc_date: "2026-09-21",
          amount_gross: -3_600_000n,
          amount_net: -3_600_000n,
          vat_amount: 0n,
          vat_status: "unknown",
          doc_kind: "expense",
          source: "sumit",
          pnl_role: "shared",
          project_id: null,
          project_name: null,
          category_id: "c1",
          category_name: "עבודה",
          supplier_name: "עובדי שטח",
          customer_name: null,
          review_status: null,
          paid: true,
          open_gross_agorot: null,
          allocations: [
            { project_id: "a", project_name: "חולון", share_bp: 4000, amount_net: -1_440_000n },
            { project_id: "b", project_name: "פתח תקווה", share_bp: 3500, amount_net: -1_260_000n },
            { project_id: "c", project_name: "רעננה", share_bp: 2500, amount_net: -900_000n },
          ],
        }}
        sampleCategories={[
          { id: "c1", name: "עבודה" },
          { id: "c2", name: "הובלה" },
        ]}
      />
    </StoryRoute>
  ),
};

const splitProjects = [
  { id: "a", name: "בניין מגורים חולון", incomeAgorot: 20_000_000n },
  { id: "b", name: "מגדל משרדים פ\"ת", incomeAgorot: 15_000_000n },
  { id: "c", name: "וילה רעננה", incomeAgorot: 10_000_000n },
  { id: "d", name: "בית פרטי כפר סבא", incomeAgorot: 5_000_000n },
];

function SplitStory({
  method,
  shares,
  context = "משכורת עובדי שטח · ספטמבר · עבודה",
  projects = splitProjects,
}: {
  method?: "equal" | "income" | "manual";
  shares?: Record<string, string>;
  context?: string;
  projects?: typeof splitProjects;
}) {
  return (
    <StoryRoute entry="/transactions/t1/split">
      <SplitScreen
        example={<span className="t-hint">{exampleLabel}</span>}
        sampleContext={context}
        sampleAmount={3_600_000n}
        sampleProjects={projects}
        sampleMethod={method}
        sampleShares={shares}
      />
    </StoryRoute>
  );
}

export const Split: Story = {
  render: () => <SplitStory method="income" />,
};

export const SplitIncome: Story = {
  render: () => <SplitStory method="income" />,
};

export const SplitEqual: Story = {
  render: () => <SplitStory method="equal" />,
};

export const SplitManual: Story = {
  render: () => <SplitStory method="manual" shares={{ a: "40", b: "30", c: "20", d: "10" }} />,
};

export const SplitPartial: Story = {
  render: () => <SplitStory method="manual" shares={{ a: "40", b: "10" }} />,
};

export const SplitLongHebrew: Story = {
  parameters: { viewport: { defaultViewport: "flow320" } },
  render: () => (
    <SplitStory
      method="income"
      context="ספק עם שם ארוך מאוד · ספטמבר · קטגוריה ארוכה שלא נכנסת בשורה אחת"
      projects={[
        { id: "a", name: "בניין מגורים חולון עם שם ארוך מאוד שלא נחתך באמצע המילה", incomeAgorot: 20_000_000n },
        { id: "b", name: "מגדל משרדים פתח תקווה ועבודות גמר כולל חשמל ואינסטלציה", incomeAgorot: 15_000_000n },
        { id: "c", name: "וילה רעננה", incomeAgorot: 10_000_000n },
        { id: "d", name: "בית פרטי כפר סבא", incomeAgorot: 5_000_000n },
      ]}
    />
  ),
};

const changeProjects = [
  { id: "holon", name: "בניין מגורים חולון", code: "P-14" },
  { id: "p14", name: "מגדל משרדים פ\"ת", code: "P-08", recent: "היום" },
  { id: "villa", name: "וילה רעננה", code: "P-02", recent: "אתמול" },
  { id: "p21", name: "בית פרטי כפר סבא", code: "P-21", recent: "לפני 3 ימים" },
  { id: "p03", name: "שיפוץ דירה ת\"א", code: "P-03", recent: "לפני שבוע" },
  { id: "p17", name: "גן יבנה – תוספת קומה", code: "P-17" },
];

const changeCategories = [
  { id: "c1", name: "חומרים", hidden: false, kind: "expense" },
  { id: "c2", name: "ציוד והשכרה", hidden: false, kind: "expense" },
  { id: "c3", name: "הובלה", hidden: false, kind: "expense" },
  { id: "c4", name: "עבודה", hidden: true, kind: "expense" },
];

function ChangeStory({
  entry = "/review/change?item=r1",
  projectId = "holon",
  categoryId = "c1",
  suggestionId = "holon",
  suggestionCategoryId = "c1",
  supplier = "חומרי בניין השרון",
  projects = changeProjects,
  categories = changeCategories,
  initialQuery,
  loading,
  saveError,
}: {
  entry?: string;
  projectId?: string;
  categoryId?: string;
  suggestionId?: string;
  suggestionCategoryId?: string;
  supplier?: string;
  projects?: typeof changeProjects;
  categories?: typeof changeCategories;
  initialQuery?: string;
  loading?: boolean;
  saveError?: boolean;
} = {}) {
  return (
    <StoryRoute entry={entry}>
      <ExampleBar />
      <ChangeForm
        sample={{
          supplier,
          amount: "₪8,500",
          suggestionId,
          suggestionCategoryId,
          projectId,
          categoryId,
          projects,
          categories,
          ...(initialQuery != null ? { initialQuery } : {}),
          ...(loading ? { loading } : {}),
          ...(saveError ? { saveError } : {}),
        }}
      />
    </StoryRoute>
  );
}

export const ChangeSheet: Story = {
  name: "Summary (suggested)",
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => <ChangeStory />,
};

export const ChangeSummaryChanged: Story = {
  name: "Summary (changed)",
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => <ChangeStory projectId="villa" categoryId="c3" suggestionCategoryId="c1" />,
};

export const ChangeProjectPicker: Story = {
  name: "Project picker",
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => <ChangeStory entry="/review/change?item=r1&pick=project" />,
};

export const ChangeProjectSearching: Story = {
  name: "Project picker searching",
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => <ChangeStory entry="/review/change?item=r1&pick=project" initialQuery="ויל" />,
};

export const ChangeProjectEmpty: Story = {
  name: "Project picker no results",
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => <ChangeStory entry="/review/change?item=r1&pick=project" initialQuery="קסם" />,
};

export const ChangeProjectLoading: Story = {
  name: "Project picker loading",
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => <ChangeStory entry="/review/change?item=r1&pick=project" loading />,
};

export const ChangeCategoryPicker: Story = {
  name: "Category picker",
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => <ChangeStory entry="/review/change?item=r1&pick=category" />,
};

export const ChangeSaveError: Story = {
  name: "Save error",
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => <ChangeStory saveError />,
};

export const ChangeLongHebrew: Story = {
  name: "Long Hebrew",
  parameters: { viewport: { defaultViewport: "flow320" } },
  render: () => (
    <ChangeStory
      supplier="חומרי בניין השרון בע״מ סניף פתח תקווה"
      projectId="long"
      suggestionId="long"
      categoryId="long-cat"
      suggestionCategoryId="long-cat"
      projects={[
        {
          id: "long",
          name: "בניין מגורים חולון עם שם ארוך מאוד שלא נחתך באמצע המילה ברוחב צר",
          code: "P-14",
        },
        ...changeProjects,
      ]}
      categories={[
        { id: "long-cat", name: "חומרי בניין וציוד כבד להשכרה כולל הובלה ופריקה באתר", hidden: false, kind: "expense" },
        ...changeCategories,
      ]}
    />
  ),
};

function SampleHome({ refreshing = false, notice }: { refreshing?: boolean; notice?: ReactNode } = {}) {
  return (
    <HomeBooks
      data={sampleDashboard}
      greeting="בוקר טוב, אלירן"
      previewing={false}
      search=""
      unpaidGross={2_340_000n}
      unpaidCount={3}
      period={{ kind: "month", from: "2026-09-01", to: "2026-09-28" }}
      onPeriod={() => undefined}
      example={exampleOnBand}
      refreshing={refreshing}
      notice={notice}
    />
  );
}

export const InstallAndroid: Story = {
  name: "Android (prompt)",
  render: () => (
    <StoryRoute entry="/">
      <InstallScreen mode="android-prompt" example={<span className="t-hint">{exampleLabel}</span>} onDismiss={() => undefined} />
    </StoryRoute>
  ),
};

export const InstallAndroidSteps: Story = {
  name: "Android (no prompt)",
  render: () => (
    <StoryRoute entry="/">
      <InstallScreen mode="android-steps" example={<span className="t-hint">{exampleLabel}</span>} onDismiss={() => undefined} />
    </StoryRoute>
  ),
};

export const InstallIphone: Story = {
  name: "iPhone Safari",
  render: () => (
    <StoryRoute entry="/">
      <InstallScreen mode="iphone" example={<span className="t-hint">{exampleLabel}</span>} onDismiss={() => undefined} />
    </StoryRoute>
  ),
};

export const InstallIphoneOther: Story = {
  name: "iPhone other browser",
  render: () => (
    <StoryRoute entry="/">
      <InstallScreen mode="iphone-other" example={<span className="t-hint">{exampleLabel}</span>} onDismiss={() => undefined} />
    </StoryRoute>
  ),
};

export const InstallIpad: Story = {
  name: "iPad",
  render: () => (
    <StoryRoute entry="/">
      <InstallScreen mode="ipad" example={<span className="t-hint">{exampleLabel}</span>} onDismiss={() => undefined} />
    </StoryRoute>
  ),
};

export const InstallAndroidDark: Story = {
  name: "Android (prompt) dark",
  globals: { theme: "dark" },
  render: () => (
    <StoryRoute entry="/">
      <InstallScreen mode="android-prompt" example={<span className="t-hint">{exampleLabel}</span>} onDismiss={() => undefined} />
    </StoryRoute>
  ),
};

export const InstallIphoneDark: Story = {
  name: "iPhone Safari dark",
  globals: { theme: "dark" },
  render: () => (
    <StoryRoute entry="/">
      <InstallScreen mode="iphone" example={<span className="t-hint">{exampleLabel}</span>} onDismiss={() => undefined} />
    </StoryRoute>
  ),
};

export const InstallIphoneNarrow: Story = {
  name: "iPhone 320",
  parameters: { viewport: { defaultViewport: "flow320" } },
  render: () => (
    <StoryRoute entry="/">
      <InstallScreen mode="iphone" example={<span className="t-hint">{exampleLabel}</span>} onDismiss={() => undefined} />
    </StoryRoute>
  ),
};

export const InvoiceReading: Story = {
  render: () => (
    <StoryRoute entry="/">
      <InvoiceReadingFrame />
    </StoryRoute>
  ),
};

export const PullToRefresh: Story = {
  render: () => (
    <StoryRoute entry="/" tabs reviewCount={7}>
      <SampleHome refreshing />
    </StoryRoute>
  ),
};

export const OfflineCached: Story = {
  render: () => (
    <StoryRoute entry="/" tabs reviewCount={7}>
      <SampleHome
        notice={
          <Banner
            icon={<OfflineIcon />}
            title={<>אין חיבור · נתונים מ-<bdi dir="ltr">09:12</bdi></>}
            action={<TextLink onClick={() => undefined}>ניסיון חוזר</TextLink>}
          />
        }
      />
    </StoryRoute>
  ),
};

export const NotificationsLock: Story = {
  render: () => (
    <StoryRoute entry="/">
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
