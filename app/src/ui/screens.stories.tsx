import type { CategoryRow, Dashboard, FiledTodayRow, ReviewRow, UnpaidRow } from "@flow/shared";
import type { ReactElement, ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { userEvent, within } from "@storybook/test";
import { Route, Routes } from "react-router-dom";
import { SAMPLE_ASSISTANT_SECRET } from "../assistant-sample";
import { AssistantSettings } from "../screens/assistant-settings";
import { HelpScreen } from "../screens/HelpScreen";
import { HomeBooks, HomeScreen } from "../screens/HomeScreen";
import {
  AddForm,
  CategoriesScreen,
  ChangeForm,
  FiledTodayScreen,
  OnboardingScreen,
  ProjectCategoryScreen,
  ProjectDetailScreen,
  ProjectsScreen,
  ReviewAllList,
  ReviewEmpty as ReviewEmptyState,
  ReviewQueue,
  ReviewScreen,
  ConnectionsScreen,
  LoansScreen,
  SettingsScreen,
  SplitScreen,
  TransactionScreen,
  UnpaidScreen,
} from "../screens/flow-screens";
import { SignInScreen } from "../screens/SignInScreen";
import { Banner } from "./banner";
import { israelToday } from "./date-math";
import { OfflineIcon } from "./icons";
import { TextLink } from "./text-link";
import { InstallScreen } from "./install-screen";
import {
  InvoiceReadingFrame,
  NotificationsLockFrame,
} from "./reference-frames.stories-support";
import { StoryRoute } from "./story-route";
import { SeedLineMeta, storyMeta } from "./story-support";
import type { TxnMeta } from "../txn-meta";
import { TabBar } from "./tab-bar";
import { ViewerPreview } from "../use-is-viewer";

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
  by_currency: [],
  projects: [
    { id: "a", name: "בניין מגורים חולון", status: "active", income_agorot: 30_000_000n, direct_agorot: 22_000_000n, shared_agorot: 0n, profit_before_shared_agorot: 8_000_000n, profit_agorot: 8_000_000n, by_currency: [] },
    { id: "b", name: "וילה רעננה", status: "active", income_agorot: 18_000_000n, direct_agorot: 13_000_000n, shared_agorot: 0n, profit_before_shared_agorot: 5_000_000n, profit_agorot: 5_000_000n, by_currency: [] },
    { id: "c", name: "מגדל משרדים פ״ת", status: "active", income_agorot: 25_000_000n, direct_agorot: 21_000_000n, shared_agorot: 0n, profit_before_shared_agorot: 4_000_000n, profit_agorot: 4_000_000n, by_currency: [] },
  ],
};

const filedTodayCount = 12;

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
  project_suggested: true,
  category_suggested: true,
  confidence: 92,
  supplier_name: "חומרי בניין השרון בע״מ",
  auto_approved_today: filedTodayCount,
};

const sampleUnpaid: UnpaidRow[] = [
  {
    id: "u1",
    description: "הובלה",
    doc_date: "2026-09-02",
    project_name: "שיפוץ דירה ת״א",
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
    by_currency: [],
  };
}

const projectsList: Dashboard = {
  ...sampleDashboard,
  projects: [
    listedProject("a", "בניין מגורים חולון"),
    listedProject("b", "וילה רעננה"),
    listedProject("c", "מגדל משרדים פ״ת"),
    ...Array.from({ length: 14 }, (_, index) => listedProject(`p${String(index)}`, `פרויקט ${String(index + 4)}`)),
    ...Array.from({ length: 21 }, (_, index) => listedProject(`f${String(index)}`, `הסתיים ${String(index + 1)}`, "finished")),
  ],
};

/** FLOW-410: more active projects than one screen, and a finished one that shares a name with an active one. */
const projectsSearch: Dashboard = {
  ...sampleDashboard,
  projects: [
    ...["בית ארז", "בית אלון", "בית ברוש", "בית דקל", "בית הדס", "בית ורד", "בית תמר", "בית חצב", "בית כלנית"].map((name, index) => listedProject(`s${String(index)}`, name)),
    listedProject("sf1", "מחסן תמר", "finished"),
    listedProject("sf2", "חנות רימון", "finished"),
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

// FLOW-321. The pending card on Home: a row to Review and a row to Unpaid, each only when it has items.
function AttentionHome({ pending, unpaidCount, unpaidGross }: { pending: number; unpaidCount: number; unpaidGross: bigint }) {
  return (
    <StoryRoute entry="/" tabs reviewCount={pending}>
      <HomeBooks
        data={{ ...sampleDashboard, review_count: pending }}
        previewing={false}
        search=""
        unpaidGross={unpaidGross}
        unpaidCount={unpaidCount}
        period={{ kind: "month", from: "2026-09-01", to: "2026-09-28" }}
        onPeriod={() => undefined}
        example={exampleOnBand}
      />
    </StoryRoute>
  );
}

const homeAt320 = { parameters: { viewport: { defaultViewport: "flow320" } } };
const homeDark = { globals: { theme: "dark" } };

export const HomeAttentionBoth: Story = {
  name: "Home attention, review and unpaid",
  render: () => <AttentionHome pending={7} unpaidCount={3} unpaidGross={2_340_000n} />,
};
export const HomeAttentionBothDark: Story = { ...HomeAttentionBoth, name: "Home attention, review and unpaid, dark", ...homeDark };
export const HomeAttentionBoth320: Story = { ...HomeAttentionBoth, name: "Home attention, review and unpaid, 320", ...homeAt320 };
export const HomeAttentionBothDark320: Story = {
  ...HomeAttentionBoth,
  name: "Home attention, review and unpaid, dark, 320",
  ...homeDark,
  ...homeAt320,
};
export const HomeAttentionReviewOnly: Story = {
  name: "Home attention, review only",
  render: () => <AttentionHome pending={7} unpaidCount={0} unpaidGross={0n} />,
};
export const HomeAttentionUnpaidOnly: Story = {
  name: "Home attention, unpaid only",
  render: () => <AttentionHome pending={0} unpaidCount={3} unpaidGross={2_340_000n} />,
};
export const HomeAttentionSingular: Story = {
  name: "Home attention, one of each",
  render: () => <AttentionHome pending={1} unpaidCount={1} unpaidGross={468_000n} />,
};
export const HomeAttentionSingular320: Story = { ...HomeAttentionSingular, name: "Home attention, one of each, 320", ...homeAt320 };

const bareReview: ReviewRow = {
  ...sampleReview,
  id: "r0",
  project_id: null,
  category_id: null,
  project_name: null,
  category_name: null,
  confidence: null,
};

export const ReviewCardQueue: Story = {
  render: () => (
    <StoryRoute entry="/review" tabs reviewCount={1}>
      <ExampleBar />
      <ReviewQueue rows={[sampleReview]} search="" sample />
    </StoryRoute>
  ),
};

export const ReviewCardViewer: Story = {
  render: () => (
    <StoryRoute entry="/review" tabs reviewCount={1} viewer>
      <ExampleBar />
      <ReviewQueue rows={[sampleReview]} search="" sample />
    </StoryRoute>
  ),
};

export const ReviewAll: Story = {
  render: () => (
    <StoryRoute entry="/review/all" tabs reviewCount={2}>
      <ExampleBar />
      <ReviewAllList
        backTo="/review"
        search=""
        rows={[
          { ...sampleReview, source: "sumit", doc_kind: "invoice", line_status: "posted" },
          {
            ...sampleReview,
            id: "r2",
            transaction_id: "t2",
            description: "מנוף ליום",
            doc_date: "2026-09-29",
            amount_net: -100_000n,
            supplier_name: "עגורני החוף בע״מ",
            project_name: null,
            category_name: "שינוע",
            source: "mercury",
            line_status: "pending",
          },
        ]}
      />
    </StoryRoute>
  ),
};

/** FLOW-305: the review list as a bank statement, two months, with היום / אתמול / date heads. Invented data. */
function reviewDay(daysAgo: number): string {
  const today = israelToday();
  const date = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)) - daysAgo));
  return date.toISOString().slice(0, 10);
}

const statementReviews: ReviewRow[] = [
  { ...sampleReview, id: "s1", transaction_id: "ts1", doc_date: reviewDay(0), supplier_name: null, description: "Northwind Traders", amount_net: -4_299n, currency: "USD", source: "mercury", line_status: "pending", project_name: null, category_name: null },
  { ...sampleReview, id: "s2", transaction_id: "ts2", doc_date: reviewDay(0), supplier_name: "חשמל השרון בע״מ", amount_net: -120_050n, source: "mercury", line_status: "posted" },
  { ...sampleReview, id: "s3", transaction_id: "ts3", doc_date: reviewDay(1), supplier_name: "לקוח לדוגמה", direction: "income", amount_net: 500_000n, source: "sumit", doc_kind: "invoice", project_name: "וילה רעננה", category_name: "מקדמות" },
  { ...sampleReview, id: "s4", transaction_id: "ts4", doc_date: reviewDay(3), supplier_name: "שיש הגליל", amount_net: -345_000n, source: "sumit", doc_kind: "receipt" },
  { ...sampleReview, id: "s5", transaction_id: "ts5", doc_date: reviewDay(40), supplier_name: "Contoso Building Supplies International", amount_net: -999_999_999n, currency: "USD", source: "mercury", line_status: "pending", category_name: "שיפוץ דירת הגג ברחוב הרצל, כולל הריסה וחשמל" },
  { ...sampleReview, id: "s6", transaction_id: "ts6", doc_date: reviewDay(41), supplier_name: null, description: "4242-1234", amount_net: -10_000n, source: "mercury", project_name: null, category_name: null },
];

/** FLOW-304 bank details for the bank lines above, seeded so the rows show card, ACH, wire and no method. */
const statementMeta: TxnMeta[] = [
  storyMeta("ts1", { method: "card", card_last4: "4242" }),
  storyMeta("ts2", { method: "ach" }),
  storyMeta("ts5", { method: "wire" }),
  storyMeta("ts6", {}),
];

function ReviewStatement() {
  return (
    <StoryRoute entry="/review/all" tabs reviewCount={statementReviews.length}>
      <SeedLineMeta meta={statementMeta} />
      <ExampleBar />
      <ReviewAllList backTo="/review" search="" rows={statementReviews} />
    </StoryRoute>
  );
}

export const ReviewAllStatement: Story = { render: () => <ReviewStatement /> };
export const ReviewAllStatementDark: Story = { render: () => <ReviewStatement />, globals: { theme: "dark" } };
export const ReviewAllStatement320: Story = { render: () => <ReviewStatement />, parameters: { viewport: { defaultViewport: "flow320" } } };
export const ReviewAllStatement320Dark: Story = {
  render: () => <ReviewStatement />,
  globals: { theme: "dark" },
  parameters: { viewport: { defaultViewport: "flow320" } },
};

export const ReviewWithoutSuggestion: Story = {
  render: () => (
    <StoryRoute entry="/review" tabs reviewCount={1}>
      <ExampleBar />
      <ReviewQueue rows={[bareReview]} search="" sample />
    </StoryRoute>
  ),
};

export const ReviewBanner: Story = {
  render: () => (
    <StoryRoute entry="/review" tabs reviewCount={1}>
      <ExampleBar />
      <ReviewQueue rows={[sampleReview]} search="" sample />
    </StoryRoute>
  ),
};

export const ReviewBannerOne: Story = {
  render: () => (
    <StoryRoute entry="/review" tabs reviewCount={1}>
      <ExampleBar />
      <ReviewQueue rows={[{ ...sampleReview, auto_approved_today: 1, assistant_filed_today: false }]} search="" sample />
    </StoryRoute>
  ),
};

export const ReviewBannerAssistant: Story = {
  render: () => (
    <StoryRoute entry="/review" tabs reviewCount={1}>
      <ExampleBar />
      <ReviewQueue rows={[{ ...sampleReview, auto_approved_today: 3, assistant_filed_today: true }]} search="" sample />
    </StoryRoute>
  ),
};

export const ReviewBannerAssistantOne: Story = {
  render: () => (
    <StoryRoute entry="/review" tabs reviewCount={1}>
      <ExampleBar />
      <ReviewQueue rows={[{ ...sampleReview, auto_approved_today: 1, assistant_filed_today: true }]} search="" sample />
    </StoryRoute>
  ),
};

const sampleFiled: FiledTodayRow[] = Array.from({ length: filedTodayCount }, (_, index) => ({
  id: index === 0 ? "t-filed" : `t-filed-${String(index)}`,
  description: index === 0 ? "מלט" : "חשבונית",
  doc_date: "2026-09-29",
  amount_net: -350_000n,
  direction: "expense" as const,
  supplier_name: index === 0 ? "מנופי המרכז בע״מ" : `ספק ${String(index + 1)}`,
  project_name: "שיפוץ הרצל 12",
  category_name: "חומרים",
}));

export const FiledToday: Story = {
  render: () => (
    <StoryRoute entry="/review/filed" tabs>
      <ExampleBar />
      <FiledTodayScreen sample={sampleFiled} />
    </StoryRoute>
  ),
};

export const FiledTodayEmpty: Story = {
  render: () => (
    <StoryRoute entry="/review/filed?preview=empty" tabs>
      <ExampleBar />
      <FiledTodayScreen sample={[]} />
    </StoryRoute>
  ),
};

export const ReviewMissingProject: Story = {
  render: () => (
    <StoryRoute entry="/review" tabs reviewCount={1}>
      <ExampleBar />
      <ReviewQueue
        rows={[{
          ...sampleReview,
          project_id: null,
          project_name: null,
          category_id: "c1",
          category_name: "חומרים",
          reason: "missing_project",
        }]}
        search=""
        sample
      />
    </StoryRoute>
  ),
};

export const ReviewFoldStress: Story = {
  name: "Fold stress",
  render: () => (
    <StoryRoute entry="/review?item=q-stress&from=all" tabs reviewCount={15}>
      <ExampleBar />
      <ReviewQueue
        rows={[{
          ...sampleReview,
          id: "q-stress",
          supplier_name: "חומרי בניין והובלות השרון בע״מ",
          description: "חומרי בניין והובלות השרון בע״מ",
          project_id: null,
          project_name: null,
          category_id: null,
          category_name: null,
          project_suggested: false,
          category_suggested: false,
          reason: "missing_category",
          pnl_role: "shared",
          share_count: 2,
          auto_approved_today: filedTodayCount,
        }]}
        search=""
        sample
        listPlace={{ index: 14, total: 15 }}
      />
    </StoryRoute>
  ),
};

const splitReviewRow: ReviewRow = {
  id: "q-split",
  transaction_id: "t-split",
  description: "מנוף ליום",
  doc_date: "2026-09-29",
  amount_net: -100_000n,
  direction: "expense",
  reason: "missing_category",
  pnl_role: "shared",
  share_count: 2,
  project_id: null,
  category_id: null,
  supplier_name: "עגורני החוף בע״מ",
  project_name: null,
  category_name: null,
  doc_kind: "invoice",
};

export const ReviewSplitMissingCategory: Story = {
  name: "Split missing category",
  render: () => (
    <StoryRoute entry="/review" tabs reviewCount={1}>
      <ExampleBar />
      <ReviewQueue rows={[splitReviewRow]} search="" sample />
    </StoryRoute>
  ),
};

export const ReviewSplitCategorySaved: Story = {
  name: "Split category saved",
  render: () => (
    <StoryRoute entry="/review" tabs reviewCount={1}>
      <ExampleBar />
      <ReviewQueue
        rows={[{
          ...splitReviewRow,
          category_id: "c-haul",
          category_name: "שינוע",
          category_suggested: false,
        }]}
        search=""
        sample
      />
    </StoryRoute>
  ),
};

export const ChangeSplitUnallocated: Story = {
  name: "Change split, unallocated",
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => (
    <ChangeStory
      supplier="עגורני החוף בע״מ"
      projectId=""
      categoryId=""
      suggestionId=""
      suggestionCategoryId=""
      split
      splitTitle="עלות משותפת · טרם פוצלה"
      projects={[
        { id: "p-alon", name: "בית הספר אלון", code: "P-01" },
        { id: "p-namal", name: "מחסן הנמל", code: "P-02" },
      ]}
      categories={[
        { id: "c1", name: "מלט", hidden: false, kind: "expense" },
        { id: "c2", name: "שינוע", hidden: false, kind: "expense" },
      ]}
    />
  ),
};

export const ReviewSharedCost: Story = {
  render: () => (
    <StoryRoute entry="/review" tabs reviewCount={1}>
      <ExampleBar />
      <ReviewQueue
        rows={[{
          ...sampleReview,
          project_id: null,
          project_name: null,
          category_id: "c1",
          category_name: "חומרים",
          reason: "unallocated_shared",
        }]}
        search=""
        sample
      />
    </StoryRoute>
  ),
};

const categorySample = {
  categoryName: "חומרים",
  projectName: "וילה רעננה",
  rows: [
    { id: "t1", description: "חומרי בניין השרון", doc_date: "2026-09-14", amount_net: -8_500_000n },
    { id: "t2", description: "מלט וחול", doc_date: "2026-09-20", amount_net: -21_500_000n },
  ],
};

export const ProjectCategory: Story = {
  render: () => (
    <StoryRoute entry="/projects/a/categories/c1">
      <ExampleBar />
      <ProjectCategoryScreen sample={categorySample} backTo="/projects/a" />
    </StoryRoute>
  ),
};

/** FLOW-107. Loan payments show their parts in the hint; one waits for review. */
const loanCategorySample = {
  categoryName: "תשלומי הלוואה",
  projectName: "וילה רעננה",
  rows: [
    { id: "l1", description: "Northgate Home Loans", doc_date: "2026-09-05", amount_net: -245_000n },
    { id: "l2", description: "Northgate Home Loans", doc_date: "2026-08-05", amount_net: -245_000n },
    { id: "l3", description: "Northgate Home Loans", doc_date: "2026-07-05", amount_net: -245_000n },
  ],
  loanMarks: { l1: "split", l2: "split", l3: "review" } as const,
};

export const ProjectCategoryLoanSplit: Story = {
  render: () => (
    <StoryRoute entry="/projects/a/categories/c1">
      <ExampleBar />
      <ProjectCategoryScreen sample={loanCategorySample} backTo="/projects/a" />
    </StoryRoute>
  ),
};

export const ProjectCategoryEmpty: Story = {
  render: () => (
    <StoryRoute entry="/projects/a/categories/c1">
      <ExampleBar />
      <ProjectCategoryScreen
        sample={{ categoryName: "חומרים", projectName: "וילה רעננה", rows: [] }}
        backTo="/projects/a"
      />
    </StoryRoute>
  ),
};

export const ProjectCategoryError: Story = {
  render: () => (
    <StoryRoute entry="/projects/a/categories/c1?preview=error">
      <ExampleBar />
      <Routes>
        <Route path="/projects/:projectId/categories/:categoryId" element={<ProjectCategoryScreen />} />
      </Routes>
    </StoryRoute>
  ),
};

export const ReviewFiltered: Story = {
  render: () => (
    <StoryRoute entry="/review?project=a" tabs reviewCount={1}>
      <ExampleBar />
      <ReviewQueue
        rows={[sampleReview]}
        search="?project=a"
        sample
        backTo="/projects/a"
        homeTo="/projects/a"
        homeLabel="חזרה לפרויקט"
      />
    </StoryRoute>
  ),
};

export const ReviewFilteredEmpty: Story = {
  render: () => (
    <StoryRoute entry="/review?project=a" tabs>
      <ExampleBar />
      <ReviewEmptyState
        search="?project=a"
        filtered
        backTo="/projects/a"
        homeTo="/projects/a"
        homeLabel="חזרה לפרויקט"
      />
    </StoryRoute>
  ),
};

export const ReviewMissingCategory: Story = {
  render: () => (
    <StoryRoute entry="/review" tabs reviewCount={1}>
      <ExampleBar />
      <ReviewQueue
        rows={[{
          ...sampleReview,
          project_id: "a",
          project_name: "וילה רעננה",
          category_id: null,
          category_name: null,
          reason: "missing_category",
        }]}
        search=""
        sample
      />
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

/** FLOW-410: a query searches every project; the finished match reads הסתיים. */
export const ProjectsSearch: Story = {
  name: "Projects, search finds a finished project",
  render: () => (
    <StoryRoute entry="/projects" tabs>
      <ExampleBar />
      <ProjectsScreen sample={projectsSearch} initialQuery="תמר" />
    </StoryRoute>
  ),
};
export const ProjectsSearchDark: Story = { ...ProjectsSearch, name: "Projects, search finds a finished project, dark", globals: { theme: "dark" } };
export const ProjectsSearch320: Story = {
  ...ProjectsSearch,
  name: "Projects, search finds a finished project, 320",
  parameters: { viewport: { defaultViewport: "flow320" } },
};
export const ProjectsSearchDark320: Story = {
  ...ProjectsSearch,
  name: "Projects, search finds a finished project, dark, 320",
  globals: { theme: "dark" },
  parameters: { viewport: { defaultViewport: "flow320" } },
};

/** FLOW-410: with no query every active project shows, past the first six. */
export const ProjectsManyActive: Story = {
  name: "Projects, every active project",
  render: () => (
    <StoryRoute entry="/projects" tabs>
      <ExampleBar />
      <ProjectsScreen sample={projectsSearch} />
    </StoryRoute>
  ),
};
export const ProjectsManyActiveDark: Story = { ...ProjectsManyActive, name: "Projects, every active project, dark", globals: { theme: "dark" } };
export const ProjectsManyActive320: Story = {
  ...ProjectsManyActive,
  name: "Projects, every active project, 320",
  parameters: { viewport: { defaultViewport: "flow320" } },
};
export const ProjectsManyActiveDark320: Story = {
  ...ProjectsManyActive,
  name: "Projects, every active project, dark, 320",
  globals: { theme: "dark" },
  parameters: { viewport: { defaultViewport: "flow320" } },
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
      <SettingsScreen
        sample={{
          name: null,
          connected: false,
          companyId: null,
          lastError: null,
          email: "owner@example.com",
          noCompany: true,
        }}
      />
    </StoryRoute>
  ),
};

export const SettingsLongEmail: Story = {
  name: "Long email",
  render: () => (
    <StoryRoute entry="/settings?preview=empty" tabs>
      <ExampleBar />
      <SettingsScreen
        sample={{
          name: null,
          connected: false,
          companyId: null,
          lastError: null,
          email: "owner.with.a.very.long.mailbox.name@example.com",
          noCompany: true,
        }}
      />
    </StoryRoute>
  ),
};

const renameBusiness = {
  name: "סטודיו אלפא לעיצוב ובנייה בע״מ",
  connected: false,
  companyId: null,
  lastError: null,
  email: "owner@example.com",
};

export const SettingsBusinessRow: Story = {
  name: "Business row, long name",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <SettingsScreen sample={renameBusiness} />
    </StoryRoute>
  ),
};

export const SettingsBusinessRowViewer: Story = {
  name: "Business row, viewer",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <ViewerPreview>
        <SettingsScreen sample={renameBusiness} />
      </ViewerPreview>
    </StoryRoute>
  ),
};

export const SettingsRenameSheet: Story = {
  name: "Rename sheet",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <SettingsScreen sample={renameBusiness} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: `שם העסק: ${renameBusiness.name}` }));
    await storyBody(canvasElement).findByRole("dialog", { name: "שם העסק" });
  },
};

export const ConnectionsAssistantConnected: Story = {
  name: "Assistant connected",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen
        sample={{
          name: "בית הספר אלון",
          connected: true,
          companyId: 1001,
          lastError: null,
          email: "owner@example.com",
          assistant: {
            state: "connected",
            scope: "read_write",
            lastUsedAt: "2026-09-30T11:05:00.000Z",
            id: "mcp-1",
          },
        }}
      />
    </StoryRoute>
  ),
};

const assistantBusiness = {
  name: "בית הספר אלון",
  connected: true,
  companyId: 1001,
  lastError: null as string | null,
  email: "owner@example.com",
};

export const ConnectionsAssistantEmpty: Story = {
  name: "Assistant empty",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...assistantBusiness, connected: false, companyId: null, assistant: { state: "empty" } }} />
    </StoryRoute>
  ),
};

export const ConnectionsAssistantLoading: Story = {
  name: "Assistant loading",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...assistantBusiness, assistant: { state: "loading" } }} />
    </StoryRoute>
  ),
};

export const ConnectionsAssistantError: Story = {
  name: "Assistant error",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...assistantBusiness, assistant: { state: "error" } }} />
    </StoryRoute>
  ),
};

export const ConnectionsAssistantMixed: Story = {
  name: "Assistant mixed",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen
        sample={{
          ...assistantBusiness,
          lastError: "sumit_auth",
          assistant: { state: "expired", scope: "read", id: "mcp-1" },
        }}
      />
    </StoryRoute>
  ),
};

export const ConnectionsAssistantExpired: Story = {
  name: "Assistant expired",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...assistantBusiness, assistant: { state: "expired", scope: "read", id: "mcp-1" } }} />
    </StoryRoute>
  ),
};

export const ConnectionsAssistantNoCompany: Story = {
  name: "Assistant no company",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...assistantBusiness, name: null, connected: false, companyId: null, noCompany: true, assistant: { state: "no-company" } }} />
    </StoryRoute>
  ),
};

function storyBody(canvasElement: HTMLElement) {
  return within(canvasElement.ownerDocument.body);
}

export const SettingsAssistantScope: Story = {
  name: "Assistant scope",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <AssistantSettings sample={{ state: "empty" }} sampleSecret={SAMPLE_ASSISTANT_SECRET} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "עוזר AI" }));
    await storyBody(canvasElement).findByRole("dialog", { name: "חיבור עוזר AI" });
  },
};

export const SettingsAssistantSecret: Story = {
  name: "Assistant secret",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <AssistantSettings sample={{ state: "empty" }} sampleSecret={SAMPLE_ASSISTANT_SECRET} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const body = storyBody(canvasElement);
    await userEvent.click(within(canvasElement).getByRole("button", { name: "עוזר AI" }));
    const sheet = await body.findByRole("dialog", { name: "חיבור עוזר AI" });
    await userEvent.click(within(sheet).getByRole("button", { name: "יצירת קוד" }));
    await body.findByRole("dialog", { name: "הקוד מוכן" });
  },
};

export const SettingsAssistantHelp: Story = {
  name: "Assistant help",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <AssistantSettings sample={{ state: "empty" }} sampleSecret={SAMPLE_ASSISTANT_SECRET} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const body = storyBody(canvasElement);
    await userEvent.click(within(canvasElement).getByRole("button", { name: "עוזר AI" }));
    const sheet = await body.findByRole("dialog", { name: "חיבור עוזר AI" });
    await userEvent.click(within(sheet).getByRole("button", { name: "יצירת קוד" }));
    const ready = await body.findByRole("dialog", { name: "הקוד מוכן" });
    await userEvent.click(within(ready).getByRole("button", { name: "איך מחברים ב־Claude" }));
    await body.findByRole("dialog", { name: "איך מחברים ב־Claude" });
  },
};

export const SettingsAssistantUsed: Story = {
  name: "Assistant used",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <AssistantSettings
        sample={{ state: "connected", scope: "read_write", id: "mcp-1", lastUsedAt: "2026-09-30T11:05:00.000Z" }}
      />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "עוזר AI" }));
    await storyBody(canvasElement).findByRole("dialog", { name: "עוזר AI" });
  },
};

export const SettingsAssistantUnused: Story = {
  name: "Assistant unused",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <AssistantSettings sample={{ state: "connected", scope: "read", id: "mcp-1", lastUsedAt: null }} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "עוזר AI" }));
    await storyBody(canvasElement).findByRole("dialog", { name: "עוזר AI" });
  },
};

export const ConnectionsConnected: Story = {
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen
        sample={{
          name: "בית הספר אלון",
          connected: true,
          companyId: 1001,
          lastError: null,
          email: "owner@example.com",
        }}
      />
    </StoryRoute>
  ),
};

export const ConnectionsSyncError: Story = {
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen
        sample={{
          name: "בית הספר אלון",
          connected: true,
          companyId: 1001,
          lastError: "sync_failed",
          email: "owner@example.com",
        }}
      />
    </StoryRoute>
  ),
};

export const ConnectionsBackoff: Story = {
  name: "Backoff",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen
        sample={{
          name: "בית הספר אלון",
          connected: true,
          companyId: 1001,
          lastError: "sumit_rejected",
          nextAttemptAt: "2099-01-01T10:00:00.000Z",
          email: "owner@example.com",
        }}
      />
    </StoryRoute>
  ),
};

export const ConnectionsAuth: Story = {
  name: "Auth",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen
        sample={{
          name: "בית הספר אלון",
          connected: true,
          companyId: 1001,
          lastError: "sumit_auth",
          email: "owner@example.com",
        }}
      />
    </StoryRoute>
  ),
};

const sumitBusiness = {
  name: "בית הספר אלון",
  email: "owner@example.com",
  companyId: 1001,
  lastError: null,
};

export const ConnectionsSumitConnected: Story = {
  name: "SUMIT connected",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...sumitBusiness, connected: true, lastSyncAt: "2026-10-03T09:05:00.000Z" }} />
    </StoryRoute>
  ),
};

export const ConnectionsSumitDisconnected: Story = {
  name: "SUMIT disconnected",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...sumitBusiness, connected: false, companyId: null }} />
    </StoryRoute>
  ),
};

export const ConnectionsSumitNoCompany: Story = {
  name: "SUMIT no company",
  render: () => (
    <StoryRoute entry="/settings/connections?preview=empty" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...sumitBusiness, name: null, connected: false, companyId: null, noCompany: true }} />
    </StoryRoute>
  ),
};

export const ConnectionsSumitReconnect: Story = {
  name: "SUMIT reconnect",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...sumitBusiness, connected: true, lastError: "sumit_auth" }} />
    </StoryRoute>
  ),
};

export const ConnectionsSumitError: Story = {
  name: "SUMIT error",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...sumitBusiness, connected: false, companyId: null, sumit: "error" }} />
    </StoryRoute>
  ),
};

export const ConnectionsSumitLoading: Story = {
  name: "SUMIT loading",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...sumitBusiness, connected: false, companyId: null, sumit: "loading" }} />
    </StoryRoute>
  ),
};

const mercuryBusiness = {
  name: "בית הספר אלון",
  email: "owner@example.com",
  companyId: 1001,
  lastError: null,
  connected: true,
  mercuryConnected: false,
  mercuryLastError: null,
};

export const ConnectionsMercuryConnected: Story = {
  name: "Mercury connected",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...mercuryBusiness, mercuryConnected: true, mercuryLastSyncAt: "2026-10-03T09:05:00.000Z" }} />
    </StoryRoute>
  ),
};

export const ConnectionsMercuryDisconnected: Story = {
  name: "Mercury disconnected",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...mercuryBusiness, mercuryConnected: false }} />
    </StoryRoute>
  ),
};

export const ConnectionsMercuryReconnect: Story = {
  name: "Mercury reconnect",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...mercuryBusiness, mercuryConnected: false, mercuryLastError: "auth" }} />
    </StoryRoute>
  ),
};

export const ConnectionsMercuryError: Story = {
  name: "Mercury error",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...mercuryBusiness, mercuryConnected: false, mercury: "error" }} />
    </StoryRoute>
  ),
};

export const ConnectionsMercuryLoading: Story = {
  name: "Mercury loading",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...mercuryBusiness, mercuryConnected: false, mercury: "loading" }} />
    </StoryRoute>
  ),
};

// FLOW-501: Settings after the change, and the two pages it opens. Invented data only.
const pagesBusiness = {
  name: "אלפא בנייה בע״מ",
  email: "owner@example.com",
  companyId: 1000,
  lastError: null,
  connected: true,
  mercuryConnected: true,
  mercuryLastSyncAt: "2026-10-07T09:00:00.000Z",
  jev: { enabled: false, mode: "shadow" as const, threshold: 0.9, status: "ready" as const },
  assistant: { state: "connected" as const, scope: "read_write" as const, id: "mcp-1" },
};

const pagesLoans = [
  { id: "l1", name: "משכנתא אלון", currency: "USD", balanceMinor: 20_000_000n, flaggedParts: 0, projectId: "p1", projectName: "וילה אלון" },
  { id: "l2", name: "הלוואת ציוד", currency: "ILS", balanceMinor: 5_000_000n, flaggedParts: 1, projectId: "p2", projectName: "פרויקט גפן" },
];

const at320 = { parameters: { viewport: { defaultViewport: "flow320" } } };
const dark = { globals: { theme: "dark" } };

export const SettingsPages: Story = {
  name: "Settings, connections and loans rows",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <SettingsScreen sample={{ ...pagesBusiness, loans: pagesLoans }} />
    </StoryRoute>
  ),
};
export const SettingsPages320: Story = { ...SettingsPages, name: "Settings, connections and loans rows, 320", ...at320 };
export const SettingsPagesDark: Story = { ...SettingsPages, name: "Settings, connections and loans rows, dark", ...dark };

export const SettingsAttention: Story = {
  name: "Settings, Mercury needs reconnecting",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <SettingsScreen sample={{ ...pagesBusiness, mercuryLastError: "auth", loans: pagesLoans }} />
    </StoryRoute>
  ),
};
export const SettingsAttention320: Story = { ...SettingsAttention, name: "Settings, Mercury needs reconnecting, 320", ...at320 };

export const SettingsHintsLoading: Story = {
  name: "Settings, hints loading",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <SettingsScreen sample={{ ...pagesBusiness, sumit: "loading", loans: "loading" }} />
    </StoryRoute>
  ),
};

export const SettingsViewer: Story = {
  name: "Settings, viewer",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <ViewerPreview>
        <SettingsScreen sample={{ ...pagesBusiness, loans: pagesLoans }} />
      </ViewerPreview>
    </StoryRoute>
  ),
};

export const Connections: Story = {
  name: "Connections",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={pagesBusiness} />
    </StoryRoute>
  ),
};
export const Connections320: Story = { ...Connections, name: "Connections, 320", ...at320 };
export const ConnectionsDark: Story = { ...Connections, name: "Connections, dark", ...dark };

export const ConnectionsReconnect: Story = {
  name: "Connections, reconnect",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...pagesBusiness, mercuryLastError: "auth", assistant: { state: "expired", scope: "read", id: "mcp-1" } }} />
    </StoryRoute>
  ),
};

export const ConnectionsLoading: Story = {
  name: "Connections, loading",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen
        sample={{
          ...pagesBusiness,
          sumit: "loading",
          mercury: "loading",
          jev: { ...pagesBusiness.jev, status: "loading" },
          assistant: { state: "loading" },
        }}
      />
    </StoryRoute>
  ),
};

export const ConnectionsError: Story = {
  name: "Connections, error",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen
        sample={{
          ...pagesBusiness,
          sumit: "error",
          mercury: "error",
          jev: { ...pagesBusiness.jev, status: "error" },
          assistant: { state: "error" },
        }}
      />
    </StoryRoute>
  ),
};
export const ConnectionsError320: Story = { ...ConnectionsError, name: "Connections, error, 320", ...at320 };

export const ConnectionsViewer: Story = {
  name: "Connections, viewer",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ViewerPreview>
        <ConnectionsScreen sample={pagesBusiness} />
      </ViewerPreview>
    </StoryRoute>
  ),
};

export const ConnectionsNoCompany: Story = {
  name: "Connections, no company",
  render: () => (
    <StoryRoute entry="/settings/connections?preview=empty" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...pagesBusiness, name: null, connected: false, companyId: null, mercuryConnected: false, noCompany: true, assistant: { state: "no-company" } }} />
    </StoryRoute>
  ),
};

export const Loans: Story = {
  name: "Loans",
  render: () => (
    <StoryRoute entry="/settings/loans" tabs>
      <ExampleBar />
      <LoansScreen sample={{ ...pagesBusiness, loans: pagesLoans }} />
    </StoryRoute>
  ),
};
export const Loans320: Story = { ...Loans, name: "Loans, 320", ...at320 };
export const LoansDark: Story = { ...Loans, name: "Loans, dark", ...dark };

export const LoansEmpty: Story = {
  name: "Loans, empty",
  render: () => (
    <StoryRoute entry="/settings/loans" tabs>
      <ExampleBar />
      <LoansScreen sample={{ ...pagesBusiness, loans: [] }} />
    </StoryRoute>
  ),
};
export const LoansEmpty320: Story = { ...LoansEmpty, name: "Loans, empty, 320", ...at320 };

export const LoansLoading: Story = {
  name: "Loans, loading",
  render: () => (
    <StoryRoute entry="/settings/loans" tabs>
      <ExampleBar />
      <LoansScreen sample={{ ...pagesBusiness, loans: "loading" }} />
    </StoryRoute>
  ),
};

export const LoansError: Story = {
  name: "Loans, error",
  render: () => (
    <StoryRoute entry="/settings/loans" tabs>
      <ExampleBar />
      <LoansScreen sample={{ ...pagesBusiness, loans: "error" }} />
    </StoryRoute>
  ),
};

export const LoansViewer: Story = {
  name: "Loans, viewer",
  render: () => (
    <StoryRoute entry="/settings/loans" tabs>
      <ExampleBar />
      <ViewerPreview>
        <LoansScreen sample={{ ...pagesBusiness, loans: pagesLoans }} />
      </ViewerPreview>
    </StoryRoute>
  ),
};
export const LoansViewer320: Story = { ...LoansViewer, name: "Loans, viewer, 320", ...at320 };

export const LoansEmptyViewer: Story = {
  name: "Loans, empty, viewer",
  render: () => (
    <StoryRoute entry="/settings/loans" tabs>
      <ExampleBar />
      <ViewerPreview>
        <LoansScreen sample={{ ...pagesBusiness, loans: [] }} />
      </ViewerPreview>
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

const keptOutCategories: Array<CategoryRow & { count?: number }> = [
  { id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: true, excluded_from_pnl: false, count: 42 },
  { id: "c6", name: "פיקדונות", kind: "expense", hidden: false, is_default: false, excluded_from_pnl: true, count: 3 },
  { id: "c7", name: "ריבית משכנתא", kind: "expense", hidden: false, is_default: true, excluded_from_pnl: false, loan_part: "interest", count: 12 },
  { id: "c8", name: "תשלומי הלוואה", kind: "expense", hidden: false, is_default: true, excluded_from_pnl: true, loan_part: "principal", count: 12 },
  { id: "c4", name: "עבודה", kind: "expense", hidden: true, is_default: true, excluded_from_pnl: true, count: 1 },
  { id: "c5", name: "תקבול", kind: "income", hidden: false, is_default: true, excluded_from_pnl: false, count: 3 },
];

export const CategoriesKeptOut: Story = {
  render: () => (
    <StoryRoute entry="/settings/categories" tabs>
      <ExampleBar />
      <CategoriesScreen sample={keptOutCategories} hiddenOpen />
    </StoryRoute>
  ),
};

export const CategoriesKeptOutMenu: Story = {
  render: () => (
    <StoryRoute entry="/settings/categories" tabs>
      <ExampleBar />
      <CategoriesScreen sample={keptOutCategories} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "עוד, חומרים" }));
    await storyBody(canvasElement).findByRole("dialog", { name: "חומרים" });
  },
};

export const CategoriesKeptOutBackMenu: Story = {
  render: () => (
    <StoryRoute entry="/settings/categories" tabs>
      <ExampleBar />
      <CategoriesScreen sample={keptOutCategories} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "עוד, פיקדונות" }));
    await storyBody(canvasElement).findByRole("dialog", { name: "פיקדונות" });
  },
};

export const CategoriesKeptOutLoanMenu: Story = {
  render: () => (
    <StoryRoute entry="/settings/categories" tabs>
      <ExampleBar />
      <CategoriesScreen sample={keptOutCategories} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "עוד, תשלומי הלוואה" }));
    await storyBody(canvasElement).findByRole("dialog", { name: "תשלומי הלוואה" });
  },
};

export const CategoriesKeptOutLongHebrew: Story = {
  parameters: { viewport: { defaultViewport: "flow320" } },
  render: () => (
    <StoryRoute entry="/settings/categories" tabs>
      <ExampleBar />
      <CategoriesScreen
        sample={longHebrewCategories.map((category) => ({ ...category, hidden: false, excluded_from_pnl: true, count: 1204 }))}
      />
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

export const ProjectSharedCost: Story = {
  name: "Shared cost note",
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
          shared_agorot: 4_000_000n,
          profit_agorot: 14_000_000n,
          categories: [
            { id: "c1", name: "חומרים", amount_agorot: 72_000_000n, has_shared_share: false },
            { id: "c2", name: "הובלה", amount_agorot: 4_000_000n, has_shared_share: true },
          ],
          pending_count: 0,
          pending_agorot: 0n,
          transactions: [],
        }}
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
          pending_count: 1,
          pending_agorot: 8_000_000n,
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
    <StoryRoute entry="/settings/categories" tabs>
      <ExampleBar />
      <CategoriesScreen sample={[]} />
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

function TransactionStory() {
  return (
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
  );
}

export const Transaction: Story = {
  render: () => <TransactionStory />,
};

/** FLOW-320: the project row opens the change sheet straight on the project picker. */
export const TransactionProjectPicker: Story = {
  name: "Project row opens the project picker",
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => <TransactionStory />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /בניין מגורים חולון/ }));
    await storyBody(canvasElement).findByRole("dialog", { name: "בחירת פרויקט" });
  },
};

/** FLOW-320: the category row opens the change sheet straight on the category picker. */
export const TransactionCategoryPicker: Story = {
  name: "Category row opens the category picker",
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => <TransactionStory />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /חומרים/ }));
    await storyBody(canvasElement).findByRole("dialog", { name: "בחירת קטגוריה" });
  },
};

export const TransactionOutOfPnl: Story = {
  name: "Out of the P&L",
  render: () => (
    <StoryRoute entry="/transactions/t1">
      <ExampleBar />
      <TransactionScreen
        sample={{
          id: "t1",
          description: "החזר פיקדון",
          direction: "expense",
          doc_date: "2026-09-21",
          amount_gross: -120_000n,
          amount_net: -120_000n,
          vat_amount: 0n,
          vat_status: "unknown",
          doc_kind: "expense",
          source: "sumit",
          project_id: "holon",
          project_name: "בניין מגורים חולון",
          category_id: "c1",
          category_name: "חומרים",
          supplier_name: "ספק לדוגמה עם שם ארוך במיוחד לבדיקה",
          customer_name: null,
          review_status: "open",
          paid: false,
          open_gross_agorot: null,
          in_pnl_override: false,
          category_excluded_from_pnl: false,
          in_pnl: false,
          pnl_fixed: false,
        }}
        sampleCategories={[{ id: "c1", name: "חומרים" }]}
      />
    </StoryRoute>
  ),
};

/** FLOW-303: opened from a list, so ˄ ˅ sit before ⋯. The middle row has both. */
export const TransactionInList: Story = {
  name: "In a list",
  render: () => (
    <StoryRoute entry="/transactions/t1" state={{ txnList: { ids: ["t0", "t1", "t2"], from: "/projects/holon" } }}>
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
      />
    </StoryRoute>
  ),
};

/** The last row: ˅ stays in place, marked unavailable. */
export const TransactionListEnd: Story = {
  name: "Last in a list",
  render: () => (
    <StoryRoute entry="/transactions/t2" state={{ txnList: { ids: ["t0", "t1", "t2"], from: "/projects/holon" } }}>
      <ExampleBar />
      <TransactionScreen
        sample={{
          id: "t2",
          description: "הובלה",
          direction: "income",
          doc_date: "2026-09-22",
          amount_gross: 12_345_678n,
          amount_net: 10_462_439n,
          vat_amount: 1_883_239n,
          vat_status: "source",
          doc_kind: "invoice",
          source: "sumit",
          project_id: "holon",
          project_name: "בניין מגורים חולון",
          category_id: "c1",
          category_name: "הכנסות מפרויקט",
          supplier_name: null,
          customer_name: "לקוח לדוגמה עם שם ארוך מאוד לבדיקה",
          review_status: "open",
          paid: false,
          open_gross_agorot: 12_345_678n,
        }}
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

export const TransactionUnsplit: Story = {
  name: "Unsplit shared",
  render: () => (
    <StoryRoute entry="/transactions/t1">
      <ExampleBar />
      <TransactionScreen
        sample={{
          id: "t1",
          description: "ביטוח אתר",
          direction: "expense",
          doc_date: "2026-09-21",
          amount_gross: -1_180_000n,
          amount_net: -1_000_000n,
          vat_amount: -180_000n,
          vat_status: "assumed",
          doc_kind: "expense",
          source: "sumit",
          pnl_role: "shared",
          project_id: null,
          project_name: null,
          category_id: null,
          category_name: null,
          supplier_name: "סוכנות הביטוח",
          customer_name: null,
          review_status: "open",
          review_reason: "missing_category",
          paid: true,
          open_gross_agorot: null,
          allocations: [],
        }}
        sampleCategories={[
          { id: "c1", name: "ביטוח" },
          { id: "c2", name: "הובלה" },
        ]}
      />
    </StoryRoute>
  ),
};

const splitProjects = [
  { id: "a", name: "בניין מגורים חולון", incomeAgorot: 20_000_000n },
  { id: "b", name: "מגדל משרדים פ״ת", incomeAgorot: 15_000_000n },
  { id: "c", name: "וילה רעננה", incomeAgorot: 10_000_000n },
  { id: "d", name: "בית פרטי כפר סבא", incomeAgorot: 5_000_000n },
];

function SplitStory({
  method,
  shares,
  chosen,
  projects = splitProjects,
  saving = false,
}: {
  method?: "equal" | "chosen" | "income" | "manual" | null;
  shares?: Record<string, string>;
  chosen?: string[];
  projects?: typeof splitProjects;
  saving?: boolean;
} = {}) {
  return (
    <StoryRoute entry="/transactions/t1/split">
      <ExampleBar />
      <SplitScreen
        sampleMeta="חשמל · 12/09/2026"
        sampleAmount={100_000n}
        sampleProjects={projects}
        sampleMethod={method}
        sampleShares={shares}
        sampleChosen={chosen}
        sampleSaving={saving}
      />
    </StoryRoute>
  );
}

function splitQuadrant(render: () => ReactElement): { base: Story; dark: Story; narrow: Story; darkNarrow: Story } {
  return {
    base: { render },
    dark: { render, globals: { theme: "dark" } },
    narrow: { render, parameters: { viewport: { defaultViewport: "flow320" } } },
    darkNarrow: { render, globals: { theme: "dark" }, parameters: { viewport: { defaultViewport: "flow320" } } },
  };
}

const splitDefault = splitQuadrant(() => <SplitStory />);
export const SplitDefault: Story = splitDefault.base;
export const SplitDefaultDark: Story = splitDefault.dark;
export const SplitDefault320: Story = splitDefault.narrow;
export const SplitDefaultDark320: Story = splitDefault.darkNarrow;

const splitAll = splitQuadrant(() => <SplitStory method="equal" />);
export const SplitAll: Story = splitAll.base;
export const SplitAllDark: Story = splitAll.dark;
export const SplitAll320: Story = splitAll.narrow;
export const SplitAllDark320: Story = splitAll.darkNarrow;

const splitSelected2 = splitQuadrant(() => <SplitStory method="chosen" chosen={["a", "c"]} />);
export const SplitSelected2: Story = splitSelected2.base;
export const SplitSelected2Dark: Story = splitSelected2.dark;
export const SplitSelected2_320: Story = splitSelected2.narrow;
export const SplitSelected2Dark320: Story = splitSelected2.darkNarrow;

const splitSelectedInvalid = splitQuadrant(() => <SplitStory method="chosen" chosen={["a"]} />);
export const SplitSelectedInvalid: Story = splitSelectedInvalid.base;
export const SplitSelectedInvalidDark: Story = splitSelectedInvalid.dark;
export const SplitSelectedInvalid320: Story = splitSelectedInvalid.narrow;
export const SplitSelectedInvalidDark320: Story = splitSelectedInvalid.darkNarrow;

const splitIncomeDisabled = splitQuadrant(() => (
  <SplitStory projects={splitProjects.map((project) => ({ ...project, incomeAgorot: 0n }))} />
));
export const SplitIncomeDisabled: Story = splitIncomeDisabled.base;
export const SplitIncomeDisabledDark: Story = splitIncomeDisabled.dark;
export const SplitIncomeDisabled320: Story = splitIncomeDisabled.narrow;
export const SplitIncomeDisabledDark320: Story = splitIncomeDisabled.darkNarrow;

const splitManualValid = splitQuadrant(() => (
  <SplitStory method="manual" shares={{ a: "25", b: "25", c: "25", d: "25" }} />
));
export const SplitManualValid: Story = splitManualValid.base;
export const SplitManualValidDark: Story = splitManualValid.dark;
export const SplitManualValid320: Story = splitManualValid.narrow;
export const SplitManualValidDark320: Story = splitManualValid.darkNarrow;

const splitManualOver = splitQuadrant(() => (
  <SplitStory method="manual" shares={{ a: "70", b: "50" }} />
));
export const SplitManualOver: Story = splitManualOver.base;
export const SplitManualOverDark: Story = splitManualOver.dark;
export const SplitManualOver320: Story = splitManualOver.narrow;
export const SplitManualOverDark320: Story = splitManualOver.darkNarrow;

const splitSaving = splitQuadrant(() => <SplitStory method="equal" saving />);
export const SplitSaving: Story = splitSaving.base;
export const SplitSavingDark: Story = splitSaving.dark;
export const SplitSaving320: Story = splitSaving.narrow;
export const SplitSavingDark320: Story = splitSaving.darkNarrow;

const changeProjects = [
  { id: "holon", name: "בניין מגורים חולון", code: "P-14" },
  { id: "p14", name: "מגדל משרדים פ״ת", code: "P-08", recent: "היום" },
  { id: "villa", name: "וילה רעננה", code: "P-02", recent: "אתמול" },
  { id: "p21", name: "בית פרטי כפר סבא", code: "P-21", recent: "לפני 3 ימים" },
  { id: "p03", name: "שיפוץ דירה ת״א", code: "P-03", recent: "לפני שבוע" },
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
  split,
  splitTitle,
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
  split?: boolean;
  splitTitle?: string;
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
          ...(split ? { split } : {}),
          ...(splitTitle != null ? { splitTitle } : {}),
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

const reversalCategories = [
  ...changeCategories,
  { id: "i1", name: "שכירות", hidden: false, kind: "income" },
  { id: "i2", name: "דמי ניהול", hidden: false, kind: "income" },
];

export const ChangeReversalPicker: Story = {
  name: "Category picker with reversals",
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => <ChangeStory entry="/review/change?item=r1&pick=category" categories={reversalCategories} />,
};

export const ChangeReversalPicked: Story = {
  name: "Reversal picked, 320",
  parameters: { viewport: { defaultViewport: "flow320" } },
  render: () => <ChangeStory entry="/review/change?item=r1&pick=category" categories={reversalCategories} categoryId="i1" suggestionCategoryId="" />,
};

export const ChangeReversalSummary: Story = {
  name: "Reversal on the summary, 320",
  parameters: { viewport: { defaultViewport: "flow320" } },
  render: () => <ChangeStory categories={reversalCategories} categoryId="i1" suggestionCategoryId="" />,
};

/** FLOW-118: a kept-out income category filed through MCP stays marked החזר and sits in the reversal section. */
const keptOutReversalCategories = [
  ...reversalCategories,
  { id: "i3", name: "העברות בין חשבונות", hidden: false, kind: "income", excluded_from_pnl: true },
];

export const ChangeReversalKeptOutSummary: Story = {
  name: "Kept-out reversal on the summary, 320",
  parameters: { viewport: { defaultViewport: "flow320" } },
  render: () => <ChangeStory categories={keptOutReversalCategories} categoryId="i3" suggestionCategoryId="" />,
};

export const ChangeReversalKeptOutPicker: Story = {
  name: "Kept-out reversal in the picker, 320",
  parameters: { viewport: { defaultViewport: "flow320" } },
  render: () => <ChangeStory entry="/review/change?item=r1&pick=category" categories={keptOutReversalCategories} categoryId="i3" suggestionCategoryId="" />,
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
  tags: ["clip-no-text"],
  render: () => (
    <StoryRoute entry="/">
      <div className="flex min-h-dvh flex-1 flex-col justify-end">
        <TabBar fabPressed />
      </div>
    </StoryRoute>
  ),
};

const usdOnlyDashboard: Dashboard = {
  ...sampleDashboard,
  income_agorot: 0n,
  expense_agorot: 0n,
  net_profit_agorot: 0n,
  by_currency: [{
    currency: "USD",
    income_minor: 500_000n,
    direct_minor: 200_000n,
    shared_minor: 0n,
    overhead_minor: 0n,
    expense_minor: 200_000n,
    net_profit_minor: 300_000n,
    count: 3,
  }],
  projects: [{
    id: "usd1",
    name: "Cedar Lot",
    status: "active",
    income_agorot: 0n,
    direct_agorot: 0n,
    shared_agorot: 0n,
    profit_before_shared_agorot: 0n,
    profit_agorot: 0n,
    by_currency: [{
      currency: "USD",
      income_minor: 500_000n,
      direct_minor: 200_000n,
      shared_minor: 0n,
      profit_minor: 300_000n,
    }],
  }],
};

const mixedCurrencyDashboard: Dashboard = {
  ...sampleDashboard,
  by_currency: [
    { currency: "ILS", income_minor: 100_000n, direct_minor: 40_000n, shared_minor: 0n, overhead_minor: 0n, expense_minor: 40_000n, net_profit_minor: 60_000n, count: 2 },
    { currency: "USD", income_minor: 200_000n, direct_minor: 50_000n, shared_minor: 0n, overhead_minor: 0n, expense_minor: 50_000n, net_profit_minor: 150_000n, count: 2 },
  ],
};

export const HomeUsdOnly: Story = {
  render: () => (
    <StoryRoute entry="/" tabs>
      <HomeBooks
        data={usdOnlyDashboard}
        previewing={false}
        search=""
        unpaidGross={0n}
        unpaidCount={0}
        period={{ kind: "month", from: "2026-09-01", to: "2026-09-28" }}
        onPeriod={() => undefined}
        example={exampleOnBand}
      />
    </StoryRoute>
  ),
};

export const HomeMixedCurrency: Story = {
  render: () => (
    <StoryRoute entry="/" tabs>
      <HomeBooks
        data={mixedCurrencyDashboard}
        previewing={false}
        search=""
        unpaidGross={0n}
        unpaidCount={0}
        period={{ kind: "month", from: "2026-09-01", to: "2026-09-28" }}
        onPeriod={() => undefined}
        example={exampleOnBand}
      />
    </StoryRoute>
  ),
};

export const ProjectUsdOnly: Story = {
  render: () => (
    <StoryRoute entry="/projects/usd1" tabs>
      <ExampleBar />
      <ProjectDetailScreen
        sample={{
          id: "usd1",
          name: "Cedar Lot",
          status: "active",
          state_label: "פעיל",
          budget_agorot: null,
          income_agorot: 0n,
          direct_agorot: 0n,
          shared_agorot: 0n,
          profit_agorot: 0n,
          by_currency: [{ currency: "USD", income_minor: 500_000n, direct_minor: 200_000n, shared_minor: 0n, profit_minor: 300_000n }],
          categories_by_currency: [{ currency: "USD", id: "u1", name: "Utilities", amount_minor: 200_000n }],
          categories: [],
          pending_count: 0,
          transactions: [],
        }}
        example={exampleOnBand}
      />
    </StoryRoute>
  ),
};

export const ProjectMixedCurrency: Story = {
  render: () => (
    <StoryRoute entry="/projects/mix1" tabs>
      <ExampleBar />
      <ProjectDetailScreen
        sample={{
          id: "mix1",
          name: "Harbor Sample",
          status: "active",
          state_label: "פעיל",
          budget_agorot: null,
          income_agorot: 100_000n,
          direct_agorot: 40_000n,
          shared_agorot: 0n,
          profit_agorot: 60_000n,
          by_currency: [
            { currency: "ILS", income_minor: 100_000n, direct_minor: 40_000n, shared_minor: 0n, profit_minor: 60_000n },
            { currency: "USD", income_minor: 200_000n, direct_minor: 50_000n, shared_minor: 0n, profit_minor: 150_000n },
          ],
          categories_by_currency: [
            { currency: "ILS", id: "i1", name: "Materials", amount_minor: 40_000n },
            { currency: "USD", id: "u1", name: "Freight", amount_minor: 50_000n },
          ],
          categories: [],
          pending_count: 0,
          transactions: [],
        }}
        example={exampleOnBand}
      />
    </StoryRoute>
  ),
};

export const TransactionUsdExpense: Story = {
  render: () => (
    <StoryRoute entry="/transactions/t-usd" tabs>
      <ExampleBar />
      <TransactionScreen
        sample={{
          id: "t-usd",
          description: "Sample vendor",
          direction: "expense",
          doc_date: "2026-09-10",
          amount_gross: -125_000n,
          amount_net: -125_000n,
          vat_amount: 0n,
          currency: "USD",
          vat_status: "source",
          source: "mercury",
          project_name: "Cedar Lot",
          category_name: "Utilities",
          supplier_name: "Sample vendor",
          customer_name: null,
        }}
      />
    </StoryRoute>
  ),
};

/** FLOW-307: the largest detail amounts step down from 36px until they fit the side padding. */
export const TransactionLargestExpense: Story = {
  render: () => (
    <StoryRoute entry="/transactions/t-large">
      <ExampleBar />
      <TransactionScreen
        sample={{
          id: "t-large",
          description: "חשבונית חומרים",
          direction: "expense",
          doc_date: "2026-09-21",
          amount_gross: -9_999_999_999n,
          amount_net: -9_999_999_999n,
          vat_amount: 0n,
          vat_status: "source",
          doc_kind: "invoice",
          source: "sumit",
          project_name: "בניין מגורים חולון",
          category_name: "חומרים",
          supplier_name: "חומרי בניין השרון בע״מ",
          customer_name: null,
        }}
      />
    </StoryRoute>
  ),
};

export const TransactionLargestUsdIncome: Story = {
  render: () => (
    <StoryRoute entry="/transactions/t-large-usd">
      <ExampleBar />
      <TransactionScreen
        sample={{
          id: "t-large-usd",
          description: "Sample customer",
          direction: "income",
          doc_date: "2026-09-10",
          amount_gross: 9_999_999_999n,
          amount_net: 9_999_999_999n,
          vat_amount: 0n,
          currency: "USD",
          vat_status: "source",
          source: "mercury",
          project_name: "Cedar Lot",
          category_name: "Rent",
          supplier_name: null,
          customer_name: "Sample customer",
        }}
      />
    </StoryRoute>
  ),
};

/* FLOW-304. Bank details on the transaction screen and the review card. Invented data only. */
function MercuryTransaction({ meta, income = false }: { meta: TxnMeta; income?: boolean }) {
  return (
    <StoryRoute entry="/transactions/t-meta" tabs>
      <SeedLineMeta meta={[meta]} />
      <ExampleBar />
      <TransactionScreen
        sample={{
          id: "t-meta",
          description: "EXAMPLE OFFICE SUITE",
          direction: income ? "income" : "expense",
          doc_date: "2026-09-10",
          amount_gross: income ? 480_000n : -125_000n,
          amount_net: income ? 480_000n : -125_000n,
          vat_amount: 0n,
          currency: "USD",
          vat_status: "source",
          source: "mercury",
          project_name: "Cedar Lot",
          category_name: income ? "Rent" : "Office",
          supplier_name: income ? null : "Example Office Suite",
          customer_name: income ? "Sample Tenant LLC" : null,
        }}
      />
    </StoryRoute>
  );
}

export const TransactionMetaNone: Story = {
  name: "Transaction bank details: none",
  render: () => <MercuryTransaction meta={storyMeta("t-meta", {})} />,
};

export const TransactionMetaCard: Story = {
  name: "Transaction bank details: card",
  render: () => (
    <MercuryTransaction
      meta={storyMeta("t-meta", {
        method: "card",
        card_last4: "4242",
        account: "Mercury Checking (1)",
        counterparty: "Example Office Suite",
        bank_description: "EXAMPLE OFFICE SUITE ••6789",
      })}
    />
  ),
};

export const TransactionMetaAchMemo: Story = {
  name: "Transaction bank details: ACH and memo",
  render: () => (
    <MercuryTransaction
      meta={storyMeta("t-meta", {
        method: "ach",
        account: "Mercury Checking ••1234",
        counterparty: "Example Office Suite Holdings",
        memo: "Invoice 1042 for the September office lease, parking, and storage",
        bank_description: "ACH EXAMPLE OFFICE SUITE HOLDINGS PPD",
      })}
    />
  ),
};

export const TransactionMetaLongMemoOpen: Story = {
  name: "Transaction bank details: long memo, open",
  render: () => (
    <MercuryTransaction
      meta={storyMeta("t-meta", {
        method: "ach",
        memo: "Invoice 1042 for the September office lease, parking for two cars, storage unit B, after-hours cleaning, the shared kitchen supplies, the lobby badge reissue, and the late fee that was waived by the landlord in August after the elevator repair",
      })}
    />
  ),
  play: async ({ canvasElement }) => {
    const toggle = await within(canvasElement).findByRole("button", { name: /הערה/ });
    await userEvent.click(toggle);
    // Route stories open with the title focused (storybook-layout's focus check); the click moved it.
    canvasElement.querySelector<HTMLElement>(".ui-focus-title")?.focus();
  },
};

export const TransactionMetaWire: Story = {
  name: "Transaction bank details: wire income",
  render: () => (
    <MercuryTransaction
      income
      meta={storyMeta("t-meta", {
        method: "wire",
        account: "Mercury Savings ••5678",
        counterparty: "Sample Tenant Holdings LLC",
        bank_description: "WIRE FROM SAMPLE TENANT HOLDINGS ••4321",
      })}
    />
  ),
};

export const TransactionMetaHebrewMemo: Story = {
  name: "Transaction bank details: Hebrew memo",
  render: () => (
    <MercuryTransaction
      meta={storyMeta("t-meta", {
        method: "transfer",
        account: "Mercury Checking ••1234",
        memo: "העברה לחשבון החיסכון לפני תשלום המע״מ של חודש ספטמבר",
      })}
    />
  ),
};

export const TransactionMetaLongAccount: Story = {
  name: "Transaction bank details: long account name",
  render: () => (
    <MercuryTransaction
      meta={storyMeta("t-meta", {
        method: "check",
        account: "Mercury Operating Reserve for Cedar Lot Construction ••1234",
        counterparty: "Example Construction Supply and Equipment Rental Company",
      })}
    />
  ),
};

const metaReviewRow: ReviewRow = {
  ...sampleReview,
  id: "q-meta",
  transaction_id: "t-meta",
  description: "EXAMPLE OFFICE SUITE",
  supplier_name: "Example Office Suite Holdings",
  amount_net: -125_000n,
  vat_agorot: 0n,
  currency: "USD",
  project_name: "Cedar Lot",
  category_name: "Office",
};

export const ReviewMetaFold: Story = {
  name: "Review bank details: fold with memo",
  render: () => (
    <StoryRoute entry="/review" tabs reviewCount={15}>
      <SeedLineMeta
        meta={[storyMeta("t-meta", { method: "wire", memo: "Invoice 1042 for the September office lease, parking, and storage" })]}
      />
      <ExampleBar />
      <ReviewQueue rows={[metaReviewRow]} search="" sample listPlace={{ index: 14, total: 15 }} />
    </StoryRoute>
  ),
};

export const ReviewMetaCard: Story = {
  name: "Review bank details: card",
  render: () => (
    <StoryRoute entry="/review" tabs reviewCount={15}>
      <SeedLineMeta meta={[storyMeta("t-meta", { method: "card", card_last4: "4242" })]} />
      <ExampleBar />
      <ReviewQueue rows={[metaReviewRow]} search="" sample />
    </StoryRoute>
  ),
};
