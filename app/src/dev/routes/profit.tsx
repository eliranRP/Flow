import { useSearchParams } from "react-router-dom";
import { ProjectProfitScreen } from "../../screens/project-profit-screen";
import { CompanyProfitScreen } from "../../screens/company-profit-screen";
import { COMPANY_PROFIT_SAMPLE } from "../company-profit-sample";
import { JUNIPER_PROFIT, NEW_PROJECT_PROFIT } from "../project-profit-sample";
import { ProjectMonthProfitScreen } from "../../screens/project-month-profit-screen";
import { JUNIPER_MONTH_PROFIT } from "../profit-month-sample";
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

/** FLOW-140c1: the company profit page; `?open=1` opens the first category, `?sheet=basis` the basis sheet. */
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
  { path: "company-profit", element: <DevCompanyProfit /> },
];
