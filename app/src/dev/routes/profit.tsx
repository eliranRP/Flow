import { useSearchParams } from "react-router-dom";
import { ProjectProfitScreen } from "../../screens/project-profit-screen";
import { CompanyProfitScreen } from "../../screens/company-profit-screen";
import { COMPANY_PROFIT_SAMPLE } from "../company-profit-sample";
import { JUNIPER_PROFIT, NEW_PROJECT_PROFIT } from "../project-profit-sample";
import { ProjectMonthProfitScreen } from "../../screens/project-month-profit-screen";
import { JUNIPER_MONTH_PROFIT } from "../profit-month-sample";
import type { DevRoute } from "./types";

/** FLOW-140 slice 1: the project profit page on the board's Juniper Ct figures; `?state=empty` is a project with no lines. */
export function DevProjectProfit() {
  const [params] = useSearchParams();
  return <ProjectProfitScreen sample={params.get("state") === "empty" ? NEW_PROJECT_PROFIT : JUNIPER_PROFIT} />;
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
