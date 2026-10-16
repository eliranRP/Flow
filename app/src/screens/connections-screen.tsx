import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { useHoldOwnerSettings, useHoldWrites, ViewerNote, ViewerScope } from "../use-is-viewer";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { useDashboardQuery, useMercuryStatusQuery, useSumitStatusQuery } from "../use-books";
import { useAssistantStatusQuery } from "./assistant-settings";
import { bindJevConnectorScope } from "./jev-review";
import { JEV_DEFAULT, JevSettings } from "./jev-settings";
import { useBlockedPreview } from "./screen-shared";
import { connectorWord, sumitKind } from "./connections-status";
import { BankIcon, DocumentIcon, NoteIcon } from "../ui/icons";
import { ConnectionHead, ConnectionNote } from "../ui/connection-page";
import { List, ListRow } from "../ui/list-row";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenState } from "../ui/screen-state";
import { Skeleton } from "../ui/skeleton";
import type { SettingsSample } from "./settings-screen";

/** The Connections note under the עזרים card (FLOW-512). */
export const HELPERS_NOTE = "תיוג חכם משייך שורות חדשות לפרויקט ולקטגוריה. חיבור ל־AI נותן ל־Claude, ל־ChatGPT או לעוזר אחר לעבוד עם הספרים.";

/** A connector's value at the row's end: its word, in the signal colour when it needs connecting. */
function statusValue(word: string, attention: boolean) {
  return attention ? <span className="ui-row-value-signal">{word}</span> : word;
}

/**
 * `/settings/connections` (FLOW-512): the bank and the books (Mercury, SUMIT), then the helpers
 * (תיוג חכם, and the AI connection). Each row opens its own page. `?sheet=` links from before the
 * pages moved there, so they open the page with their query.
 */
export function ConnectionsScreen({ sample }: { sample?: SettingsSample; sampleSecret?: string } = {}) {
  const preview = useHomePreview();
  const [params] = useSearchParams();
  const previewValue = params.get("preview");
  const search = usePreviewSearch();
  const { session } = useAuth();
  const holdWrites = useHoldWrites();
  const holdOwner = useHoldOwnerSettings();
  const blocked = useBlockedPreview();
  const status = useSumitStatusQuery(sample == null);
  const mercuryStatus = useMercuryStatusQuery(sample == null);
  const dashboard = useDashboardQuery(sample == null);
  const signedInUserId = session?.user.id;
  const signedInCompanyId = dashboard.data?.company_id;
  if (signedInUserId && signedInCompanyId) {
    bindJevConnectorScope({ userId: signedInUserId, companyId: signedInCompanyId });
  }
  const liveCompany = sample == null && preview === "off" && signedInCompanyId != null;
  const assistant = useAssistantStatusQuery(liveCompany);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, dashboard);

  const asked = params.get("sheet");
  if (sample == null && (asked === "sumit" || asked === "mercury" || asked === "assistant")) {
    const target = asked === "assistant" ? "/settings/connections/ai" : `/settings/connections/${asked}`;
    const next = new URLSearchParams(params);
    next.delete("sheet");
    const rest = next.toString();
    return <Navigate to={{ pathname: target, search: rest === "" ? "" : `?${rest}` }} replace />;
  }

  if (phase.kind === "loading" || phase.kind === "error") {
    return (
      <ScreenState
        title="חיבורים"
        kicker="הגדרות"
        backTo={`/settings${search}`}
        phase={phase}
        onRetry={() => { void dashboard.refetch(); }}
      />
    );
  }

  const noCompany = sample
    ? sample.noCompany === true
    : previewValue === "empty" || (preview === "off" && dashboard.data?.company_id == null);
  const connected = noCompany ? false : sample ? sample.connected : status.data?.connected === true;
  const rawError = sample ? sample.lastError : status.data?.last_error;
  const authReconnect = rawError === "sumit_auth";
  const sumitState = sumitKind({
    forced: sample?.sumit ?? null,
    noCompany,
    statusLoading: sample == null && !noCompany && status.isLoading,
    statusFailed: sample == null && status.isError && status.data == null,
    authReconnect,
    connected,
  });
  const mercuryConnected = noCompany ? false : sample ? sample.mercuryConnected === true : mercuryStatus.data?.connected === true;
  const mercuryRawError = sample ? sample.mercuryLastError : mercuryStatus.data?.last_error;
  const mercuryState = sumitKind({
    forced: sample?.mercury ?? null,
    noCompany,
    statusLoading: sample == null && !noCompany && mercuryStatus.isLoading,
    statusFailed: sample == null && mercuryStatus.isError && mercuryStatus.data == null,
    authReconnect: mercuryRawError === "auth",
    connected: mercuryConnected,
  });
  const aiState = sample ? (sample.assistant?.state ?? "empty") : (assistant.data?.state ?? (assistant.isError ? "error" : "loading"));
  const aiWord = noCompany ? "אין עסק עדיין" : aiState === "connected" ? "מחובר" : aiState === "expired" ? (holdOwner ? "לא מחובר" : "פג תוקף") : aiState === "error" ? "לא הצלחנו לטעון" : aiState === "loading" ? null : "לא מחובר";
  const viewerOnly = holdOwner;
  const providerValue = (state: ReturnType<typeof sumitKind>, word: string, loadingFlag: boolean) => {
    if (loadingFlag || state === "loading") return <Skeleton width="sm" />;
    if (state === "error") return "לא הצלחנו לטעון";
    return statusValue(word, state === "reconnect" && !viewerOnly);
  };
  const sumitLoading = sumitState === "loading";
  const mercuryLoading = mercuryState === "loading";

  return (
    <ViewerScope>
    <div>
      <ScreenHeader title="חיבורים" backTo={`/settings${search}`} backText="הגדרות" />
      <ViewerNote />
      <ConnectionHead>בנק וספרים</ConnectionHead>
      <List>
        <ListRow
          variant="item"
          href={`/settings/connections/mercury${search}`}
          title="Mercury"
          icon={<BankIcon size={24} />}
          value={noCompany ? "אין עסק עדיין" : providerValue(mercuryState, connectorWord(mercuryState, viewerOnly), mercuryLoading)}
          chevron
        />
        <ListRow
          variant="item"
          href={`/settings/connections/sumit${search}`}
          title="SUMIT"
          icon={<DocumentIcon size={24} />}
          value={noCompany ? "אין עסק עדיין" : providerValue(sumitState, connectorWord(sumitState, viewerOnly), sumitLoading)}
          chevron
        />
      </List>
      {noCompany ? null : (
        <>
          <ConnectionHead>עזרים</ConnectionHead>
          <JevSettings
            noCompany={noCompany}
            blocked={blocked}
            readOnly={holdWrites}
            sample={
              sample
                ? (sample.jev ?? JEV_DEFAULT)
                : preview !== "off"
                  ? JEV_DEFAULT
                  : undefined
            }
          />
          <List>
            <ListRow
              variant="item"
              href={`/settings/connections/ai${search}`}
              title="חיבור ל־AI (MCP)"
              icon={<NoteIcon size={24} />}
              value={aiWord == null ? <Skeleton width="sm" /> : statusValue(aiWord, aiState === "expired" && !holdOwner)}
              chevron
            />
          </List>
          <ConnectionNote>{HELPERS_NOTE}</ConnectionNote>
        </>
      )}
    </div>
    </ViewerScope>
  );
}
