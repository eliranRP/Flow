import { Navigate, useSearchParams } from "react-router-dom";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { useDashboardQuery } from "../use-books";
import { ScreenState } from "../ui/screen-state";
import { List, ListRow } from "../ui/list-row";
import { useBlockedPreview } from "./screen-shared";
import { ViewerNote, ViewerScope } from "../use-is-viewer";
import { type LoanBalanceRow } from "./loan-match";
import { type LoanCurrency, type LoanProjectChoice, type LoanSetupInitial } from "./loan-setup";
import { LoansHost, type LoanRowsSample } from "./loans-host";
import { LoansList } from "./loans-list";
import type { LoanListSummary } from "./loan-list-summary";

/** FLOW-501. Invented loans for `?preview=1`. */
const PREVIEW_LOANS: LoanBalanceRow[] = [
  { id: "preview-loan-1", name: "משכנתא אלון", currency: "USD", balanceMinor: 20_000_000n, flaggedParts: 0, projectId: "preview-alon", projectName: "וילה אלון" },
  { id: "preview-loan-2", name: "הלוואת ציוד", currency: "ILS", balanceMinor: 5_000_000n, flaggedParts: 1, projectId: "preview-gefen", projectName: "פרויקט גפן" },
];

/** A story or the dev fixture's loans. Live reads the company's loans and lines. */
export type LoansSample = {
  loans?: LoanRowsSample;
  loanProjects?: LoanProjectChoice[];
  loanCurrency?: LoanCurrency;
  noCompany?: boolean;
  /** The summary card's figures, for a sample. */
  summary?: LoanListSummary;
  /** Dev proof only: the new-loan sheet opens, with these values typed in. */
  openSheet?: "new";
  newLoan?: LoanSetupInitial;
};

/**
 * The הלוואות tab (FLOW-139b, the board's Loans frame): a top-level screen, not under Settings. The
 * header, the summary card, the open loans, then the closed group, collapsed. A viewer reads it.
 * With no company it goes to Settings, as Categories does. `closedOpen` opens the closed group (the dev fixture's ?closed=1).
 */
export function LoansScreen({ sample, closedOpen = false }: { sample?: LoansSample; closedOpen?: boolean } = {}) {
  const preview = useHomePreview();
  const [params] = useSearchParams();
  const previewValue = params.get("preview");
  const search = usePreviewSearch();
  const blocked = useBlockedPreview();
  const dashboard = useDashboardQuery(sample == null);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, dashboard);
  const previewNoCompany = sample == null && previewValue === "empty";
  const sampleNoCompany = sample?.noCompany === true;
  const liveNoCompany = sample == null && preview === "off" && dashboard.isSuccess && dashboard.data.company_id == null;
  if (previewNoCompany || sampleNoCompany || liveNoCompany) {
    return <Navigate to={`/settings${search}`} replace />;
  }
  if (phase.kind === "loading" || phase.kind === "error") {
    return (
      <ScreenState
        title="הלוואות"
        phase={phase}
        onRetry={() => { void dashboard.refetch(); }}
        loading={(
          <List>
            <ListRow variant="skeleton" />
            <ListRow variant="skeleton" />
          </List>
        )}
      />
    );
  }
  const sampled = sample != null || preview !== "off";
  return (
    <ViewerScope>
      <ViewerNote />
      <LoansHost
        companyId={sampled ? null : (dashboard.data?.company_id ?? null)}
        companyCurrency={sampled ? (sample?.loanCurrency ?? "ILS") : undefined}
        blocked={blocked}
        sample={sample ? (sample.loans ?? []) : preview !== "off" ? PREVIEW_LOANS : undefined}
        summary={sample?.summary}
        openNew={sample?.openSheet === "new"}
        newLoan={sample?.newLoan}
        projects={sampled
          ? { rows: sample?.loanProjects ?? [] }
          : {
            rows: (dashboard.data?.projects ?? []).map((project) => ({ id: project.id, name: project.name, status: project.status, code: project.code })),
            loading: dashboard.isLoading,
            error: dashboard.isError,
            retrying: dashboard.isFetching,
            onRetry: () => { void dashboard.refetch(); },
          }}
      >
        {(ctx) => <LoansList ctx={ctx} closedOpen={closedOpen} />}
      </LoansHost>
    </ViewerScope>
  );
}
