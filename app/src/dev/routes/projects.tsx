import { useEffect } from "react";
import { DevProjectProfitEmpty } from "./profit";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { BackButton } from "../../ui/back";
import { ProjectDetailScreen, ProjectsScreen } from "../../screens/flow-screens";
import { ProjectInvestmentScreen } from "../../screens/project-investment-screen";
import { useHomePreview } from "../../preview";
import { cash as devCash, cashRow as devCashRow, investment as devInvestment, months as devMonths, project as devProject } from "../project-cash-sample";
import { devProjectsCash } from "../projects-sample";
import { kindOf, kindSample } from "../project-kinds-sample";
import { birchLaneInvestment, birchLaneNegativeInvestment, birchLaneNoArvInvestment, birchLaneRehabCategories } from "../investment-sample";
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
  state_label: "ריצוף • עבודת לקוח",
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
  const [params] = useSearchParams();
  // The fixture company is in dollars: the new-project sheet's budget field reads "$".
  const queryClient = useQueryClient();
  const preview = useHomePreview();
  useEffect(() => { queryClient.setQueryData(["company-currency", preview], "USD"); }, [queryClient, preview]);
  return <ProjectsScreen sample={devDashboard} cashSample={devProjectsCash} finishedOpen={params.get("finished") === "1"} />;
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
  const kind = kindOf(params.get("kind"));
  const kinded = kind == null ? null : kindSample(kind, menuBase);
  const menuRow = kinded?.row ?? (menuBase == null ? undefined : { ...menuBase, id: "p1", pending_count: deletable ? 0 : 2, deletable, first_month: deletable ? "2026-10-01" : "2026-07-01" });
  return (
    <>
    <OpenProjectMenu sheet={params.get("sheet")} />
    <ProjectDetailScreen
      sampleMenuRow={menuRow}
      // The investment row opens the investment page fixture.
      sectionTo={(target) => (target === "overview" ? "/e2e/project-detail?preview=1" : "/e2e/project-investment?preview=1")}
      // `?budget=1` draws the flip with its budget (the board's flip frame, invented names and figures).
      sample={kinded?.project ?? (deletable ? idleProject : { ...e2eProject, budget_agorot: params.get("budget") === "1" ? e2eProject.budget_agorot : null })}
      sampleCash={kinded?.cash ?? (deletable ? idleCash : devCash)}
      sampleInvestment={kinded?.investment ?? (deletable ? idleInvestment : devInvestment)}
    />
    {params.get("add") === "1" ? <AddForm /> : null}
    </>
  );
}

/** Proof: taps the row that opens a sheet once the page has drawn (the real trigger, not a state flag). */
function OpenInvestmentSheet({ sheet, field }: { sheet: string | null; field: string | null }) {
  useEffect(() => {
    if (sheet !== "edit" && sheet !== "rehab") return;
    const label = sheet === "rehab" ? "שיפוץ עד היום" : field === "purchase" ? "מחיר רכישה" : field === "value" ? "שווי היום" : "שווי אחרי שיפוץ (ARV)";
    const started = Date.now();
    const timer = window.setInterval(() => {
      const target = [...document.querySelectorAll<HTMLButtonElement>("main button, #root button")].find((button) => button.textContent.startsWith(label));
      if (target) {
        target.click();
        window.clearInterval(timer);
      } else if (Date.now() - started > 4000) {
        window.clearInterval(timer);
      }
    }, 100);
    return () => { window.clearInterval(timer); };
  }, [sheet, field]);
  return null;
}

/**
 * FLOW-446 (board Invest): `?arv=none` the missing ARV, `?negative=1` today's value under the loans,
 * `?sheet=edit&field=arv|purchase|value` and `?sheet=rehab` open a sheet through its row.
 */
export function DevProjectInvestment() {
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const preview = useHomePreview();
  useEffect(() => { queryClient.setQueryData(["company-currency", preview], "USD"); }, [queryClient, preview]);
  const data = params.get("arv") === "none" ? birchLaneNoArvInvestment : params.get("negative") === "1" ? birchLaneNegativeInvestment : birchLaneInvestment;
  return (
    <>
      <OpenInvestmentSheet sheet={params.get("sheet")} field={params.get("field")} />
      <ProjectInvestmentScreen
        sample={devProject}
        sampleInvestment={data}
        sampleCategories={birchLaneRehabCategories}
        backTo="/e2e/project-detail?preview=1"
        today="2026-10-17"
      />
    </>
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
  ["/install?preview=1", "התקנה לדוגמה"],
  ["/review/change?preview=1", "שינוי לדוגמה"],
  ["/e2e/split-category?save=fail", "פיצול שנכשל"],
  ["/e2e/project-month-profit", "רווח חודש לדוגמה"],
];

export function DevProject() {
  return (
    <main className="ui-page-pad">
      <h1 className="t-total">פרויקט לבדיקה</h1>
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
      <h1 className="t-total">הוצאה לבדיקה</h1>
      <BackButton fallback="/projects?preview=1" />
    </main>
  );
}

export const projectRoutes: DevRoute[] = [
  { path: "project", element: <DevProject /> },
  { path: "expense", element: <DevExpense /> },
];

export const projectsRoutes: DevRoute[] = [
  { path: "projects", element: <DevProjects /> },
  { path: "project-detail", element: <DevProjectDetail /> },
  { path: "project-investment", element: <DevProjectInvestment /> },
  { path: "project-profit-empty", element: <DevProjectProfitEmpty /> },
];
