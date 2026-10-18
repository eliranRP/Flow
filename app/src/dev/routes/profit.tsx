import { useSearchParams } from "react-router-dom";
import { ProjectProfitScreen } from "../../screens/project-profit-screen";
import { CompanyProfitScreen } from "../../screens/company-profit-screen";
import { COMPANY_PROFIT_SAMPLE } from "../company-profit-sample";
import { JUNIPER_PROFIT, NEW_PROJECT_PROFIT } from "../project-profit-sample";
import { ProjectMonthProfitScreen } from "../../screens/project-month-profit-screen";
import { JUNIPER_MONTH_PROFIT } from "../profit-month-sample";
import { ProjectNextEditScreen, type ProjectNextEditSample } from "../../screens/project-next-edit-screen";
import { ProjectNextMonthScreen } from "../../screens/project-next-month-screen";
import { JUNIPER_NEXT, JUNIPER_NEXT_EDITED } from "../project-next-month-sample";
import type { DevRoute } from "./types";

/** FLOW-140 slice 1: the project profit page on the board's Juniper Ct figures. */
export function DevProjectProfit() {
  return <ProjectProfitScreen sample={JUNIPER_PROFIT} />;
}

/** A project with no lines (board States, profitEmpty). It sits under the Projects tab, as the board's frame does. */
export function DevProjectProfitEmpty() {
  return <ProjectProfitScreen sample={NEW_PROJECT_PROFIT} />;
}

export function DevProjectMonthProfit() {
  return <ProjectMonthProfitScreen sample={JUNIPER_MONTH_PROFIT} />;
}

/** The ProfitNext frame: Juniper Ct's November forecast; `?state=edited` is ProfitNextEdited (a change, a removal, an added line). */
export function DevProjectNextMonth() {
  const [params] = useSearchParams();
  return <ProjectNextMonthScreen sample={{ ...JUNIPER_PROFIT, next: params.get("state") === "edited" ? JUNIPER_NEXT_EDITED : JUNIPER_NEXT }} />;
}

/** ProfitNextEdit: the repairs average's edit page, its amount typed as 1,200. */
export function DevProjectNextEdit() {
  return <ProjectNextEditScreen sample={{ ...JUNIPER_PROFIT, next: JUNIPER_NEXT, rowKey: "avg:repairs", draft: "1200" }} />;
}

/** The add page's board frames: ProfitNextAdd, and `?preset=` search, nomatch (the category sheet) or pace. */
const ADD_PRESETS: Record<string, Partial<ProjectNextEditSample>> = {
  add: { categoryId: "property-mgmt", draft: "305" },
  search: { sheet: "category", query: "ביטוח" },
  nomatch: { sheet: "category", query: "שמירה" },
  pace: { categoryId: "pest", draft: "65", pace: "quarter", sheet: "pace" },
};

export function DevProjectNextAdd() {
  const [params] = useSearchParams();
  const preset = ADD_PRESETS[params.get("preset") ?? "add"] ?? ADD_PRESETS.add;
  return <ProjectNextEditScreen add sample={{ ...JUNIPER_PROFIT, next: JUNIPER_NEXT, ...preset }} />;
}

/** FLOW-140c1: the company profit page; `?open=1` opens the first income category, `?sheet=basis` the basis sheet. */
export function DevCompanyProfit() {
  const [params] = useSearchParams();
  return (
    <CompanyProfitScreen
      sample={{ ...COMPANY_PROFIT_SAMPLE, openFirst: params.get("open") === "1", sheetOpen: params.get("sheet") === "basis" }}
    />
  );
}

export const profitRoutes: DevRoute[] = [
  { path: "project-profit", element: <DevProjectProfit /> },
  { path: "project-month-profit", element: <DevProjectMonthProfit /> },
  { path: "project-next-month", element: <DevProjectNextMonth /> },
  { path: "project-next-edit", element: <DevProjectNextEdit /> },
  { path: "project-next-add", element: <DevProjectNextAdd /> },
  { path: "company-profit", element: <DevCompanyProfit /> },
];
