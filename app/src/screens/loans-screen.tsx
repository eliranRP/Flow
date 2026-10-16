import { Navigate, useSearchParams } from "react-router-dom";
import type { LoanBalanceRow } from "./loan-match";
import { ViewerNote, ViewerScope } from "../use-is-viewer";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { useDashboardQuery } from "../use-books";
import { List, ListRow } from "../ui/list-row";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenState } from "../ui/screen-state";
import { useBlockedPreview } from "./screen-shared";
import { LoanSettingsSection, type LoanRowsSample } from "./loan-setup";
import type { SettingsSample } from "./settings-screen";

/** FLOW-501. Invented loans for `?preview=1`. */
export const PREVIEW_LOANS: LoanBalanceRow[] = [
  { id: "preview-loan-1", name: "משכנתא אלון", currency: "USD", balanceMinor: 20_000_000n, flaggedParts: 0, projectId: "preview-alon", projectName: "וילה אלון" },
  { id: "preview-loan-2", name: "הלוואת ציוד", currency: "ILS", balanceMinor: 5_000_000n, flaggedParts: 1, projectId: "preview-gefen", projectName: "פרויקט גפן" },
];

/**
 * `/loans` (FLOW-501): the balances and הלוואה חדשה, moved out of
 * Settings. Viewers read the balances (U10). No company goes back to Settings,
 * like Categories. `/loans/:id` is kept for FLOW-110's detail page.
 */
export function LoansScreen({ sample }: { sample?: SettingsSample } = {}) {
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
        kicker="הגדרות"
        backTo={`/settings${search}`}
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
    <div>
      <ScreenHeader title="הלוואות" kicker="הגדרות" backTo={`/settings${search}`} />
      <ViewerNote />
      <LoanSettingsSection
        companyId={sampled ? null : (dashboard.data?.company_id ?? null)}
        companyCurrency={sampled ? (sample?.loanCurrency ?? "ILS") : undefined}
        blocked={blocked}
        sample={sample ? (sample.loans ?? []) : preview !== "off" ? PREVIEW_LOANS : undefined}
        projects={sampled
          ? { rows: sample?.loanProjects ?? [] }
          : {
            rows: (dashboard.data?.projects ?? []).map((project) => ({ id: project.id, name: project.name, status: project.status, code: project.code })),
            loading: dashboard.isLoading,
            error: dashboard.isError,
            retrying: dashboard.isFetching,
            onRetry: () => { void dashboard.refetch(); },
          }}
      />
    </div>
    </ViewerScope>
  );
}
