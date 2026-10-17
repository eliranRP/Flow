import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { LoanDetailScreen, type LoanView } from "../../screens/loan-detail-screen";
import { LoansScreen } from "../../screens/loans-screen";
import { useMemoryLoanStore } from "../../screens/loan-detail-store";
import { devLoanStore, resetDevLoanStore, SAMPLE_LOAN_PROJECTS } from "../loan-detail-sample";
import { LoanSummaryCard } from "../../screens/loan-summary-card";
import { LOAN_SUMMARY_SAMPLE } from "../loan-summary-sample";
import { useDevSettingsSample } from "./settings";
import type { DevRoute } from "./types";

/** FLOW-139d: the new-loan sheet's board values (invented lender, round amounts). */
const NEW_LOAN_SAMPLE = { name: "Pinecrest Lending", principal: "240000", rate: "6.25", term: "360", startDate: "2026-11-01", escrow: "360", currency: "USD" } as const;

/** FLOW-106 B: the list reads the dev loan store, so a status change or a delete on a loan's page shows here. `?loans=none` is empty, `?closed=1` opens the closed group, `?sheet=new` opens the new-loan sheet. */
export function DevLoans() {
  const [params] = useSearchParams();
  const settings = useDevSettingsSample();
  const store = devLoanStore();
  useMemoryLoanStore(store);
  const newSheet = params.get("sheet") === "new";
  return (
    <LoansScreen
      closedOpen={params.get("closed") === "1"}
      sample={{
        noCompany: settings?.noCompany,
        ...(newSheet ? { openSheet: "new" as const, newLoan: NEW_LOAN_SAMPLE } : {}),
        loanProjects: SAMPLE_LOAN_PROJECTS,
        loanCurrency: "USD",
        summary: params.get("loans") === "none" ? undefined : LOAN_SUMMARY_SAMPLE,
        loans: params.get("loans") === "none" ? [] : store.rows(),
      }}
    />
  );
}

/**
 * FLOW-106 B / FLOW-110: a loan's page on fake data. `?reset=1` starts the dev store over;
 * `?today=YYYY-MM-DD` pins the day (the board frames were drawn on 2026-10-17, so the next payment reads 01/11).
 */
export function DevLoanDetail({ view }: { view?: LoanView } = {}) {
  const [params] = useSearchParams();
  // StrictMode runs the initializer twice, so the page reads the current store, not the returned one.
  useState(() => (params.get("reset") === "1" ? resetDevLoanStore() : null));
  const store = devLoanStore();
  const preview = params.get("preview");
  const today = params.get("today");
  useOpenKindRow(params.get("sheet") === "kind");
  return (
    <LoanDetailScreen
      store={store}
      view={view}
      today={today != null && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : undefined}
      listPath={`/e2e/loans${preview ? `?preview=${encodeURIComponent(preview)}` : ""}`}
    />
  );
}

/** FLOW-139d proof: `?sheet=kind` taps the סוג row once the page has drawn, so the kind sheet opens. */
function useOpenKindRow(wanted: boolean) {
  useEffect(() => {
    if (!wanted) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const row = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent.trim().startsWith("סוג"));
      if (row) {
        row.click();
        window.clearInterval(timer);
      } else if (Date.now() - started > 4000) {
        window.clearInterval(timer);
      }
    }, 100);
    return () => { window.clearInterval(timer); };
  }, [wanted]);
}

/** FLOW-139. The loans list's summary card alone, for the board proof. */
export function DevLoanSummary() {
  return (
    <div className="ui-page-pad">
      <LoanSummaryCard summary={LOAN_SUMMARY_SAMPLE} currency="USD" />
    </div>
  );
}

export const loansRoutes: DevRoute[] = [
  { path: "loans", element: <DevLoans /> },
  { path: "loans-summary", element: <DevLoanSummary /> },
  { path: "loans/:loanId", element: <DevLoanDetail /> },
  { path: "loans/:loanId/payments", element: <DevLoanDetail view="payments" /> },
];
