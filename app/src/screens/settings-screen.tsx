import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Navigate, NavigationType, useLocation, useNavigate, useNavigationType, useSearchParams } from "react-router-dom";
import { useLoanBalances, type LoanBalanceRow } from "./loan-match";
import { useAuth } from "../auth";
import { useHoldWrites, ViewerNote, ViewerScope } from "../use-is-viewer";
import { getSupabase } from "../lib/supabase";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { isStandalone } from "../ui/install-prompt";
import { useDashboardQuery, useMercuryStatusQuery, useSumitStatusQuery } from "../use-books";
import { assertNoError, useWrite } from "../use-write";
import { useAssistantStatusQuery, type AssistantSample } from "./assistant-settings";
import { RenameCompanySheet } from "./rename-company";
import { CompanyCurrencySheet } from "./company-currency-sheet";
import { useCompanyCurrencyQuery } from "../company-currency";
import { currencyChoiceLabel } from "../ui/currency-sheet";
import { bindJevConnectorScope, clearJevConnectorFlag } from "./jev-review";
import { JEV_DEFAULT, jevSwitchOn, useJevIntegrationQuery, type JevCardState } from "./jev-settings";
import { LoanSettingsSection, type LoanCurrency, type LoanProjectChoice, type LoanRowsSample } from "./loan-setup";
import { useSetupSettingsEntry } from "../setup/settings-row";
import { useSheetHistory } from "../ui/back";
import { AlertIcon, BuildingIcon, CoinIcon, DownloadIcon, GoogleIcon, LoanIcon, LogoutIcon, PlugIcon, SplitIcon, TagIcon } from "../ui/icons";
import { SectionHead } from "../ui/layout";
import { List, ListRow } from "../ui/list-row";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenState } from "../ui/screen-state";
import { Toggle } from "../ui/toggle";
import { Skeleton } from "../ui/skeleton";
import { useBlockedPreview } from "./screen-shared";

/** Shown on `/settings?preview=` when the value is not `empty` and no sample is passed. */
const previewAccountName = "בית הספר אלון";
const previewAccountEmail = "owner@example.com";

export type SettingsSample = {
  name: string | null;
  connected: boolean;
  companyId: number | null;
  lastError: string | null;
  nextAttemptAt?: string | null;
  email?: string | null;
  /** Shown in the connected sheet when present. A missing time is omitted. */
  lastSyncAt?: string | null;
  /** Live `company_id` is null. Preview passes this because a sample skips the dashboard. */
  noCompany?: boolean;
  /** Story fixture. Live status comes from the query. */
  sumit?: "loading" | "error";
  mercury?: "loading" | "error";
  mercuryConnected?: boolean;
  mercuryLastError?: string | null;
  mercuryLastSyncAt?: string | null;
  assistant?: AssistantSample;
  jev?: JevCardState;
  /** Preview only. Live settings read the company's lines. */
  loanCurrency?: LoanCurrency;
  /** FLOW-119. Projects for the loan's project picker. */
  loanProjects?: LoanProjectChoice[];
  /** FLOW-501. The Loans page and the Settings הלוואות hint. */
  loans?: LoanRowsSample;
};

/** FLOW-501. Invented loans for `?preview=1`. */
const PREVIEW_LOANS: LoanBalanceRow[] = [
  { id: "preview-loan-1", name: "משכנתא אלון", currency: "USD", balanceMinor: 20_000_000n, flaggedParts: 0, projectId: "preview-alon", projectName: "וילה אלון" },
  { id: "preview-loan-2", name: "הלוואת ציוד", currency: "ILS", balanceMinor: 5_000_000n, flaggedParts: 1, projectId: "preview-gefen", projectName: "פרויקט גפן" },
];

/** One connector as the Settings חיבורים hint counts it (FLOW-501). */
export type ConnectorTally = { name: string; state: "loading" | "error" | "active" | "off" | "reconnect" };

export type ConnectionsHint =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "attention"; text: string }
  | { kind: "count"; active: number; total: number };

/**
 * The Settings חיבורים hint: "N מתוך M פעילים", or the one connector that needs
 * reconnecting, or how many do. Loading and a failed read win, so the count is
 * never a guess. The retry lives on the page.
 */
export function connectionsHint(list: readonly ConnectorTally[]): ConnectionsHint {
  if (list.some((item) => item.state === "loading")) return { kind: "loading" };
  if (list.some((item) => item.state === "error")) return { kind: "error" };
  const broken = list.filter((item) => item.state === "reconnect");
  if (broken.length === 1) return { kind: "attention", text: `${broken[0]?.name ?? ""}: צריך לחבר מחדש` };
  if (broken.length > 1) return { kind: "attention", text: `${String(broken.length)} חיבורים צריכים חיבור מחדש` };
  return { kind: "count", active: list.filter((item) => item.state === "active").length, total: list.length };
}

/** The Settings הלוואות hint: the count, never a total (mixed currencies have none). */
export function loansCountHint(count: number): ReactNode {
  if (count === 0) return "אין הלוואות עדיין";
  if (count === 1) return "הלוואה אחת";
  return <><bdi className="ui-num" dir="ltr">{String(count)}</bdi> הלוואות</>;
}

function queryTally(
  name: string,
  query: { isLoading: boolean; isError: boolean; data: unknown },
  ready: () => ConnectorTally["state"],
): ConnectorTally {
  if (query.isLoading) return { name, state: "loading" };
  if (query.isError && query.data == null) return { name, state: "error" };
  return { name, state: ready() };
}

function assistantTally(sample: AssistantSample): ConnectorTally["state"] {
  if (sample.state === "loading") return "loading";
  if (sample.state === "error" || sample.error === true) return "error";
  if (sample.state === "connected") return "active";
  if (sample.state === "expired") return "reconnect";
  return "off";
}

/** The page Back returns to, so Settings can put focus back on its row. */
let settingsOpened: "connections" | "loans" | null = null;

/**
 * `/settings` (0082, amended by 0116): the account rows, then one quiet group
 * with חיבורים and הלוואות, then תצוגה and עוד. An old `?sheet=` link moves to
 * the Connections page with its query, so the sheet still opens there.
 */
export function SettingsScreen(props: { sample?: SettingsSample } = {}) {
  const [params] = useSearchParams();
  const location = useLocation();
  const sheet = params.get("sheet");
  if (sheet === "sumit" || sheet === "mercury" || sheet === "assistant" || sheet === "jev") {
    return <Navigate to={{ pathname: "/settings/connections", search: location.search }} replace state={location.state as unknown} />;
  }
  return <SettingsHome sample={props.sample} />;
}

function SettingsHome({ sample }: { sample?: SettingsSample }) {
  const preview = useHomePreview();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const previewValue = params.get("preview");
  const search = usePreviewSearch();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const { session } = useAuth();
  const holdWrites = useHoldWrites();
  const blocked = useBlockedPreview();
  const dashboard = useDashboardQuery(sample == null);
  const signedInUserId = session?.user.id;
  const signedInCompanyId = dashboard.data?.company_id;
  const setupEntry = useSetupSettingsEntry(signedInUserId ?? null, signedInCompanyId ?? null);
  if (signedInUserId && signedInCompanyId) {
    bindJevConnectorScope({ userId: signedInUserId, companyId: signedInCompanyId });
  }
  const live = sample == null && preview === "off";
  const liveCompanyId = live ? (signedInCompanyId ?? null) : null;
  const liveCompany = liveCompanyId != null;
  const sumit = useSumitStatusQuery(sample == null && (preview !== "off" || signedInCompanyId != null));
  const mercury = useMercuryStatusQuery(sample == null && (preview !== "off" || signedInCompanyId != null));
  const jev = useJevIntegrationQuery(liveCompany);
  const assistant = useAssistantStatusQuery(liveCompany);
  const loans = useLoanBalances(liveCompanyId);
  const [renameOpen, setRenameOpen] = useState(false);
  const businessRowRef = useRef<HTMLButtonElement>(null);
  const setRenameSheet = useSheetHistory("company-rename", renameOpen, setRenameOpen);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const currencyRowRef = useRef<HTMLButtonElement>(null);
  const currencyQuery = useCompanyCurrencyQuery(liveCompany);
  const [overheadOn, setOverheadOn] = useState(false);
  const wantedOverhead = useRef(false);
  useEffect(() => {
    if (sample) return;
    if (dashboard.data) setOverheadOn(dashboard.data.after_overhead === true);
  }, [sample, dashboard.data]);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, dashboard);
  // Back from a page puts focus on the row that opened it. A fresh visit does not.
  // Read once per mount: StrictMode reruns the effect after the title has taken focus.
  const [openedPage] = useState(() => settingsOpened);
  useEffect(() => {
    settingsOpened = null;
    // The rows draw once the screen stops loading, in a preview too.
    if (phase.kind === "loading") return;
    if (openedPage == null || navigationType !== NavigationType.Pop) return;
    const row = document.querySelector<HTMLElement>(`[data-settings-page="${openedPage}"] a`);
    row?.focus({ preventScroll: true });
  }, [phase.kind, navigationType, openedPage]);
  const saveOverhead = useWrite({
    failure: "לא הצלחנו לשמור את התצוגה.",
    keys: ["dashboard", "project"],
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("set_after_overhead", { p_on: wantedOverhead.current }));
    },
  });
  const signOut = useWrite({
    failure: "לא הצלחנו לצאת.",
    keys: [],
    onSuccess: () => { void navigate("/sign-in"); },
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      clearJevConnectorFlag(session?.user.id ?? null);
      queryClient.removeQueries({ queryKey: ["jev-connector"] });
      queryClient.removeQueries({ queryKey: ["company-owner"] });
    },
  });

  if (phase.kind === "loading" || phase.kind === "error") {
    return (
      <ScreenState
        title="הגדרות"
        phase={phase}
        onRetry={() => { void dashboard.refetch(); }}
      />
    );
  }

  const noCompany = sample
    ? sample.noCompany === true
    : previewValue === "empty" || (preview === "off" && dashboard.data?.company_id == null);
  const previewSample = sample == null && preview !== "off" && previewValue !== "empty";
  const businessName = sample ? sample.name : previewSample ? previewAccountName : dashboard.data?.name;
  // A sample or preview has no stored currency to read; it shows the sample's.
  const currencyReady = !live || currencyQuery.isSuccess;
  const currencyFailed = live && currencyQuery.isError;
  const companyCurrency = live ? (currencyQuery.data ?? "ILS") : (sample?.loanCurrency ?? "ILS");
  const currencyHint = currencyChoiceLabel(companyCurrency);
  const email = (sample ? sample.email : previewSample ? previewAccountEmail : session?.user.email)?.trim() ?? "";
  const namedBusiness = (businessName ?? "").trim();
  const showInstall = !isStandalone();
  const showSignOut = preview === "off" || previewValue === "empty";

  const tallies: ConnectorTally[] = sample
    ? [
      { name: "SUMIT", state: sample.sumit ?? (sample.lastError === "sumit_auth" ? "reconnect" : sample.connected ? "active" : "off") },
      { name: "Mercury", state: sample.mercury ?? (sample.mercuryLastError === "auth" ? "reconnect" : sample.mercuryConnected === true ? "active" : "off") },
      { name: "תיוג חכם", state: (() => {
        const state = sample.jev ?? JEV_DEFAULT;
        if (state.status === "loading" || state.status === "error") return state.status;
        return jevSwitchOn(state) ? "active" : "off";
      })() },
      { name: "עוזר AI", state: assistantTally(sample.assistant ?? { state: "empty" }) },
    ]
    : [
      queryTally("SUMIT", sumit, () => (sumit.data?.last_error === "sumit_auth" ? "reconnect" : sumit.data?.connected === true ? "active" : "off")),
      queryTally("Mercury", mercury, () => (mercury.data?.last_error === "auth" ? "reconnect" : mercury.data?.connected === true ? "active" : "off")),
      queryTally("תיוג חכם", jev, () => (jev.data != null && jevSwitchOn({ ...jev.data, status: "ready" }) ? "active" : "off")),
      queryTally("עוזר AI", assistant, () => {
        const state = assistant.data?.state;
        return state === "connected" ? "active" : state === "expired" ? "reconnect" : "off";
      }),
    ];
  // A viewer cannot reconnect, so an expired connector reads as off (V29).
  const hint = connectionsHint(holdWrites
    ? tallies.map((item) => (item.state === "reconnect" ? { ...item, state: "off" as const } : item))
    : tallies);
  const connectionsRowHint: ReactNode = noCompany
    ? "אין עסק עדיין"
    : hint.kind === "loading"
      ? <Skeleton width="sm" />
      : hint.kind === "error"
        ? "לא הצלחנו לטעון"
        : hint.kind === "attention"
          ? hint.text
          : <><bdi className="ui-num" dir="ltr">{String(hint.active)}</bdi> מתוך <bdi className="ui-num" dir="ltr">{String(hint.total)}</bdi> פעילים</>;
  const connectionsWarning = !noCompany && hint.kind === "attention";

  const loanSample: LoanRowsSample | undefined = sample
    ? (sample.loans ?? [])
    : preview !== "off"
      ? (previewValue === "empty" ? [] : PREVIEW_LOANS)
      : undefined;
  const loansLoading = loanSample === "loading" || (loanSample == null && (loans.isLoading || (dashboard.isFetching && signedInCompanyId == null)));
  const loansFailed = loanSample === "error" || (loanSample == null && loans.isError);
  const loanCount = Array.isArray(loanSample) ? loanSample.length : (loans.data ?? []).length;
  const loansRowHint: ReactNode = loansLoading
    ? <Skeleton width="sm" />
    : loansFailed
      ? "לא הצלחנו לטעון"
      : loansCountHint(loanCount);

  return (
    <ViewerScope>
    <div>
      <ScreenHeader title="הגדרות" />
      <ViewerNote />
      {noCompany ? (
        email !== "" ? (
          <List>
            <ListRow variant="static" title={email} ltrTitle icon={<GoogleIcon />} />
          </List>
        ) : null
      ) : namedBusiness !== "" ? (
        <List>
          {holdWrites ? (
            <ListRow variant="static" title={namedBusiness} icon={<BuildingIcon />} />
          ) : (
            <ListRow
              variant="button"
              title={namedBusiness}
              label={`שם העסק: ${namedBusiness}`}
              icon={<BuildingIcon />}
              chevron
              buttonRef={businessRowRef}
              onClick={() => { setRenameSheet(true); }}
            />
          )}
          {/* FLOW-504: a change waits for the stored currency, so undo never writes a guess. */}
          {currencyReady && !holdWrites ? (
            <ListRow
              variant="button"
              title="מטבע העסק"
              hint={currencyHint}
              label={`מטבע העסק: ${currencyHint}`}
              icon={<CoinIcon />}
              chevron
              buttonRef={currencyRowRef}
              onClick={() => { setCurrencyOpen(true); }}
            />
          ) : (
            <ListRow
              variant="static"
              title="מטבע העסק"
              hint={currencyFailed ? "לא הצלחנו לטעון" : currencyHint}
              skelHint={!currencyReady && !currencyFailed}
              icon={<CoinIcon />}
            />
          )}
          {email !== "" ? <ListRow variant="static" title={email} ltrTitle icon={<GoogleIcon />} /> : null}
        </List>
      ) : null}
      {!noCompany && !holdWrites && namedBusiness !== "" && currencyReady ? (
        <CompanyCurrencySheet
          open={currencyOpen}
          onOpenChange={setCurrencyOpen}
          currency={companyCurrency}
          blocked={() => blocked(sample != null ? "empty" : undefined)}
          returnFocusRef={currencyRowRef}
        />
      ) : null}
      {!noCompany && !holdWrites && namedBusiness !== "" ? (
        <RenameCompanySheet
          open={renameOpen}
          onOpenChange={(next) => { setRenameSheet(next); }}
          companyId={sample || previewSample ? null : dashboard.data?.company_id ?? null}
          currentName={namedBusiness}
          blocked={() => blocked(sample != null ? "empty" : undefined)}
          returnFocusRef={businessRowRef}
        />
      ) : null}
      <List>
        <SettingsPageRow
          page="connections"
          href={`/settings/connections${search}`}
          title="חיבורים"
          icon={connectionsWarning ? <AlertIcon size={24} /> : <PlugIcon />}
          hint={connectionsRowHint}
          skeleton={!noCompany && hint.kind === "loading"}
          warning={connectionsWarning}
        />
        {noCompany ? null : (
          <SettingsPageRow
            page="loans"
            href={`/settings/loans${search}`}
            title="הלוואות"
            icon={<LoanIcon />}
            hint={loansRowHint}
            skeleton={loansLoading}
          />
        )}
      </List>
      {noCompany ? null : (
        <>
          <SectionHead title="תצוגה" />
          <List>
            <ListRow variant="item" href={`/settings/categories${search}`} title="קטגוריות" icon={<TagIcon />} chevron />
            <Toggle
              label="רווח אחרי כלליות"
              hint="חלק מהכלליות נכנס לכל פרויקט"
              icon={<SplitIcon />}
              checked={overheadOn}
              disabled={holdWrites}
              onChange={(checked) => {
                if (holdWrites) return;
                if (sample) {
                  setOverheadOn(checked);
                  return;
                }
                if (blocked()) return;
                const previous = overheadOn;
                setOverheadOn(checked);
                wantedOverhead.current = checked;
                saveOverhead.mutate(undefined, { onError: () => { setOverheadOn(previous); } });
              }}
            />
          </List>
        </>
      )}
      {showInstall || showSignOut || (setupEntry != null && !holdWrites) ? (
        <>
          <SectionHead title="עוד" />
          <List>
            {setupEntry && !holdWrites ? (
              <ListRow
                variant="item"
                href={setupEntry.href}
                title="הגדרה ראשונה"
                hint={<><bdi className="ui-num" dir="ltr">{String(setupEntry.done)}</bdi> מתוך <bdi className="ui-num" dir="ltr">5</bdi></>}
                describeHint
                chevron
              />
            ) : null}
            {showInstall ? (
              <ListRow variant="item" href={`/install${search}`} title="התקנה למסך הבית" hint="נפתח כמו אפליקציה" icon={<DownloadIcon />} chevron />
            ) : null}
            {showSignOut ? (
              <ListRow
                variant="danger"
                title="התנתקות"
                icon={<LogoutIcon />}
                busy={signOut.isPending}
                onClick={() => {
                  signOut.mutate();
                }}
              />
            ) : null}
          </List>
        </>
      ) : null}
      <p className="ui-poc t-hint"><bdi dir="ltr">Flow 0.1</bdi></p>
    </div>
    </ViewerScope>
  );
}

/** A Settings row that opens a page. Viewers navigate too: reading is allowed (§2.8). */
function SettingsPageRow({
  page,
  href,
  title,
  icon,
  hint,
  skeleton = false,
  warning = false,
}: {
  page: "connections" | "loans";
  href: string;
  title: string;
  icon: ReactNode;
  hint: ReactNode;
  skeleton?: boolean;
  warning?: boolean;
}) {
  return (
    <span
      className="ui-settings-page-row"
      data-settings-page={page}
      onClickCapture={() => { settingsOpened = page; }}
    >
      <ListRow
        variant="item"
        href={href}
        title={title}
        icon={icon}
        hint={hint}
        skelHint={skeleton}
        describeHint={!skeleton}
        wrapHint
        tone={warning ? "warning" : undefined}
        chevron
      />
    </span>
  );
}

/**
 * `/settings/loans` (FLOW-501): the balances and הלוואה חדשה, moved out of
 * Settings. Viewers read the balances (U10). No company goes back to Settings,
 * like Categories. `/settings/loans/:id` is kept for FLOW-110's detail page.
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

