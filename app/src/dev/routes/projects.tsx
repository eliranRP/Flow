import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { BackButton } from "../../ui/back";
import { ProjectCategoryScreen, ProjectDetailScreen, ProjectsScreen } from "../../screens/flow-screens";
import { useHomePreview } from "../../preview";
import { cash as devCash, cashRow as devCashRow, investment as devInvestment, months as devMonths, project as devProject } from "../project-cash-sample";
import { devProjectsCash } from "../projects-sample";
import { SAMPLE_EXPECTED, SAMPLE_EXPECTED_EMPTY } from "../../forecast-sample";
import { ProfitMonthsScreen } from "../../screens/profit-months";
import { devDashboard } from "./home";
import { AddForm } from "../../screens/add-sheet";
import type { DevRoute } from "./types";

/** The scroll the board's scrolled frame shows the page at (CSS px). */
const DEV_SCROLLED_Y = 320;

/** The e2e route's project: one category with a waiting line, so the expenses rows and the queue link open. */
const e2eProject: typeof devProject = {
  ...devProject,
  categories_by_currency: [{ currency: "USD", id: "c1", name: "חומרים", amount_minor: 4_000_000n }],
  pending_count: 2,
  pending_agorot: 40_000n,
  // The profit since the start (the board's second profit row).
  by_currency: (devProject.by_currency ?? []).map((row) => ({ ...row, profit_minor: -6_130_000n })),
  transactions: devProject.transactions.map((line) => (line.id === "t1" ? { ...line, description: "מלט" } : line)),
};

/** `?deletable=1`: a project with no activity and no investment card (the board's deletable frame), invented name. */
const idleProject: typeof devProject = {
  ...devProject,
  name: "מטבח לקוח לדוגמה",
  state_label: "עבודת לקוח",
  budget_agorot: null,
  direct_agorot: 0n,
  by_currency: [],
  pending_count: 0,
  pending_agorot: 0n,
  transactions: [],
  loans: [],
};
const idleCash = devMonths([[devCashRow(0n, 0n, 0n)]]);
const idleInvestment = { isOverhead: false, figures: null, categories: [], loans: [] };

export function DevProjects() {
  return <ProjectsScreen sample={devDashboard} cashSample={devProjectsCash} />;
}

/**
 * Proof: `?sheet=menu` taps the page's ⋯ button once it has drawn; `?sheet=finish` then taps the menu's
 * finish row, so the confirm sheet draws (the real triggers, not a state flag).
 */
function OpenProjectMenu({ sheet }: { sheet: string | null }) {
  useEffect(() => {
    if (sheet !== "menu" && sheet !== "finish") return;
    const started = Date.now();
    let step: "more" | "finish" = "more";
    const timer = window.setInterval(() => {
      const target = step === "more"
        ? document.querySelector<HTMLButtonElement>('button[aria-label="עוד"]')
        : [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent.startsWith("סיום הפרויקט"));
      if (target) {
        target.click();
        if (sheet === "menu" || step === "finish") {
          window.clearInterval(timer);
          return;
        }
        step = "finish";
      } else if (Date.now() - started > 4000) {
        window.clearInterval(timer);
      }
    }, 100);
    return () => { window.clearInterval(timer); };
  }, [sheet]);
  return null;
}

export function DevProjectDetail() {
  const [params] = useSearchParams();
  const section = params.get("section");
  // The fixture company is in dollars: the preview's company-currency read answers USD.
  const queryClient = useQueryClient();
  const preview = useHomePreview();
  useEffect(() => { queryClient.setQueryData(["company-currency", preview], "USD"); }, [queryClient, preview]);
  // `?scrolled=1` is the board's scrolled frame: the page is scrolled past the band, so the compact bar shows.
  useEffect(() => {
    if (params.get("scrolled") !== "1") return;
    const timer = window.setTimeout(() => { window.scrollTo(0, DEV_SCROLLED_Y); }, 0);
    return () => { window.clearTimeout(timer); };
  }, [params]);
  // The menu's month row: the sample project's pending line (the finish warning), and deletable with `?deletable=1`.
  const deletable = params.get("deletable") === "1";
  const menuBase = devProjectsCash.projects[0];
  const menuRow = menuBase == null ? undefined : { ...menuBase, id: "p1", pending_count: deletable ? 0 : 2, deletable };
  return (
    <>
    <OpenProjectMenu sheet={params.get("sheet")} />
    <ProjectDetailScreen
      sampleMenuRow={menuRow}
      // FLOW-340 C: `?section=` draws the screen a row opens, on the same sample (FLOW-419: `profit` too).
      section={section === "profit" || section === "expenses" || section === "investment" || section === "loans" || section === "transactions" ? section : "overview"}
      sectionTo={(target) => (target === "overview" ? "/e2e/project-detail?preview=1" : `/e2e/project-detail?preview=1&section=${target}`)}
      sampleExpected={params.get("expected") === "none" ? SAMPLE_EXPECTED_EMPTY : SAMPLE_EXPECTED}
      // `?budget=1` draws the flip with its budget (the board's flip frame, invented names and figures).
      sample={deletable ? idleProject : { ...e2eProject, budget_agorot: params.get("budget") === "1" ? e2eProject.budget_agorot : null }}
      sampleCash={deletable ? idleCash : devCash}
      sampleInvestment={deletable ? idleInvestment : devInvestment}
      categoryTo="/e2e/project-category"
    />
    {params.get("add") === "1" ? <AddForm /> : null}
    </>
  );
}

/** Dev-only months for the "לפי חודש" page: one open month, a loss and a profit. */
/** `?empty=1` is a project with no month yet (review-cycle fixture, FLOW-335). */
export function DevProjectMonths() {
  const [params] = useSearchParams();
  if (params.get("empty") === "1") {
    return (
      <ProfitMonthsScreen
        sample={{
          projectName: "שיפוץ הרצל 12",
          data: { basis: "invoiced", from: null, to: null, project_id: "p1", after_overhead: false, months: [], by_currency: [] },
        }}
      />
    );
  }
  return (
    <ProfitMonthsScreen
      sample={{
        projectName: "שיפוץ הרצל 12",
        data: {
          basis: "invoiced",
          from: "2026-08-01",
          to: "2026-10-08",
          project_id: "p1",
          after_overhead: false,
          months: [
            { month: "2026-10", from: "2026-10-01", to: "2026-10-08", open: true, by_currency: [{ currency: "ILS", income_minor: 0n, expense_minor: 40_000n, profit_minor: -40_000n }] },
            { month: "2026-09", from: "2026-09-01", to: "2026-09-30", open: false, by_currency: [{ currency: "ILS", income_minor: 0n, expense_minor: 120_000n, profit_minor: -120_000n }] },
            { month: "2026-08", from: "2026-08-01", to: "2026-08-31", open: false, by_currency: [{ currency: "ILS", income_minor: 1_000_000n, expense_minor: 300_000n, profit_minor: 700_000n }] },
          ],
          by_currency: [{ currency: "ILS", income_minor: 1_000_000n, expense_minor: 460_000n, profit_minor: 540_000n }],
        },
      }}
    />
  );
}

const devLinks: Array<[string, string]> = [
  ["/e2e/expense", "הוצאה לבדיקה"],
  ["/projects/herzl?preview=1", "פרויקט לדוגמה"],
  ["/transactions/1?preview=1", "תנועה לדוגמה"],
  ["/transactions/1/split-category?preview=1", "פיצול לדוגמה"],
  ["/settings/categories?preview=1", "קטגוריות לדוגמה"],
  ["/settings/connections?preview=1", "חיבורים לדוגמה"],
  ["/loans?preview=1", "הלוואות לדוגמה"],
  ["/unpaid?preview=1", "חשבוניות לדוגמה"],
  ["/onboarding?preview=1", "הצטרפות לדוגמה"],
  ["/install?preview=1", "התקנה לדוגמה"],
  ["/review/change?preview=1", "שינוי לדוגמה"],
  ["/e2e/split-category?save=fail", "פיצול שנכשל"],
];

export function DevProject() {
  return (
    <main className="ui-page-pad">
      <h1 className="t-title-1">פרויקט לבדיקה</h1>
      <div style={{ blockSize: "1800px" }} />
      <nav className="ui-stack">
        {devLinks.map(([to, label]) => (
          <Link key={to} to={to}>{label}</Link>
        ))}
      </nav>
    </main>
  );
}

export function DevExpense() {
  return (
    <main className="ui-page-pad">
      <h1 className="t-title-1">הוצאה לבדיקה</h1>
      <BackButton fallback="/projects?preview=1" />
    </main>
  );
}

export function DevProjectCategory() {
  return (
    <ProjectCategoryScreen
      backTo="/e2e/project-detail"
      sample={{
        categoryName: "חומרים",
        projectName: "שיפוץ הרצל 12",
        rows: [{
          id: "t1",
          description: "מלט",
          doc_date: "2026-09-12",
          amount_net: -400n,
        }],
      }}
    />
  );
}

export const projectRoutes: DevRoute[] = [
  { path: "project", element: <DevProject /> },
  { path: "expense", element: <DevExpense /> },
];

export const projectsRoutes: DevRoute[] = [
  { path: "projects", element: <DevProjects /> },
  { path: "project-detail", element: <DevProjectDetail /> },
  { path: "project-category", element: <DevProjectCategory /> },
  { path: "project-months", element: <DevProjectMonths /> },
];
