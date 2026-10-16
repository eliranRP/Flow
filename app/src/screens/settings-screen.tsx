import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Navigate, NavigationType, useLocation, useNavigate, useNavigationType, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { useCompanyRole, useHoldOwnerSettings, ViewerNote, ViewerScope } from "../use-is-viewer";
import { MY_COMPANIES_KEY, useMyCompaniesQuery, useTeamQuery } from "../team-queries";
import { ROLE_LABEL } from "../team-api";
import type { BasisChoice } from "../ui/company-choices";
import { getSupabase } from "../lib/supabase";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { isStandalone } from "../ui/install-prompt";
import { useCategoriesQuery, useDashboardQuery, useMercuryStatusQuery, useSumitStatusQuery } from "../use-books";
import { useWrite } from "../use-write";
import { useAssistantStatusQuery, type AssistantSample } from "./assistant-settings";
import { CompanySheet } from "./company-switcher";
import { bindJevConnectorScope, clearJevConnectorFlag } from "./jev-review";
import { JEV_DEFAULT, jevLocked, jevSwitchOn, useJevIntegrationQuery, useJevKeyStatusQuery, type JevCardState } from "./jev-settings";
import { LoanSettingsSection, type LoanCurrency, type LoanProjectChoice, type LoanRowsSample } from "./loan-setup";
import { type LoanBalanceRow } from "./loan-match";
import { useSetupSettingsEntry } from "../setup/settings-row";
import { useSheetHistory } from "../ui/back";
import { BellIcon, BuildingIcon, DownloadIcon, PeopleIcon, PlugIcon, SparkIcon, TagIcon, ThemeIcon, TransferIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenState } from "../ui/screen-state";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { NO_PREFS, pushConfigured, useNotificationPrefsQuery, type NotificationPrefs } from "../push";
import { notificationsHint } from "./notifications-screen";
import { themeChoiceLabel, THEME_TITLE } from "../ui/theme-choices";
import { readThemeChoice, writeThemeChoice, type ThemeChoice } from "../theme-store";
import { ThemeSheet } from "./theme-sheet";
import { useBlockedPreview } from "./screen-shared";

/** FLOW-501. Invented loans for `?preview=1`. */
const PREVIEW_LOANS: LoanBalanceRow[] = [
  { id: "preview-loan-1", name: "משכנתא אלון", currency: "USD", balanceMinor: 20_000_000n, flaggedParts: 0, projectId: "preview-alon", projectName: "וילה אלון" },
  { id: "preview-loan-2", name: "הלוואת ציוד", currency: "ILS", balanceMinor: 5_000_000n, flaggedParts: 1, projectId: "preview-gefen", projectName: "פרויקט גפן" },
];

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
  /** The role word under the email line: owner, editor or viewer. A sample defaults to owner. */
  role?: "owner" | "editor" | "viewer";
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
  /** FLOW-501. The Loans page. */
  loans?: LoanRowsSample;
  /** FLOW-502. The התראות row's count. */
  notifications?: NotificationPrefs;
  /** FLOW-601. The צוות row's count; left out, a sample has no צוות row. */
  teamCount?: number;
  /** The visible categories, for the קטגוריות row. */
  categoryCount?: number;
  /** The businesses the person belongs to, for the החלפת עסק row. */
  companyCount?: number;
  /** FLOW-103. The company's profit basis, for the העסק page's row (a sample or preview). */
  basis?: BasisChoice;
  /** Setup steps still to do (the הגדרה ראשונה row shows only while any is left). */
  setupLeft?: number;
};

/** One connector as the Settings חיבורים row counts it (FLOW-501). */
export type ConnectorTally = { name: string; state: "loading" | "error" | "active" | "off" | "reconnect" };

export type ConnectionsHint =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "attention"; text: string }
  | { kind: "count"; active: number; total: number };

/**
 * The Settings חיבורים row: "N פעילים", or the connector that needs connecting ("SUMIT צריך חיבור"),
 * or how many do. Loading and a failed read win, so the count is never a guess.
 */
export function connectionsHint(list: readonly ConnectorTally[]): ConnectionsHint {
  if (list.some((item) => item.state === "loading")) return { kind: "loading" };
  if (list.some((item) => item.state === "error")) return { kind: "error" };
  const broken = list.filter((item) => item.state === "reconnect");
  if (broken.length === 1) return { kind: "attention", text: `${broken[0]?.name ?? ""} צריך חיבור` };
  if (broken.length > 1) return { kind: "attention", text: `${String(broken.length)} צריכים חיבור` };
  return { kind: "count", active: list.filter((item) => item.state === "active").length, total: list.length };
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
let settingsOpened: SettingsPage | null = null;

type SettingsPage = "business" | "connections" | "team" | "notifications" | "categories";

/**
 * `/settings` (0082, FLOW-512): the menu. Card 1 is the business's pages (העסק, חיבורים, צוות,
 * התראות, קטגוריות), each with its value at the end. Card 2 is the appearance, the business
 * switch and the install row, then the sign-out text and the version. An old `?sheet=` link moves
 * to the connections page, so the sheet still opens there.
 */
export function SettingsScreen(props: { sample?: SettingsSample } = {}) {
  const [params] = useSearchParams();
  const location = useLocation();
  const sheet = params.get("sheet");
  if (sheet === "sumit" || sheet === "mercury" || sheet === "assistant" || sheet === "jev") {
    const target = sheet === "sumit" || sheet === "mercury" ? `/settings/connections/${sheet}` : "/settings/connections";
    const next = new URLSearchParams(params);
    next.delete("sheet");
    const search = next.toString();
    return <Navigate to={{ pathname: target, search: search === "" ? "" : `?${search}` }} replace state={location.state as unknown} />;
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
  const role = useCompanyRole();
  // FLOW-601: the business name, its currency, connectors, setup and the team are the owner's.
  const holdOwner = useHoldOwnerSettings();
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
  const team = useTeamQuery(liveCompany && !holdOwner);
  const sumit = useSumitStatusQuery(sample == null && (preview !== "off" || signedInCompanyId != null));
  const mercury = useMercuryStatusQuery(sample == null && (preview !== "off" || signedInCompanyId != null));
  const jev = useJevIntegrationQuery(liveCompany);
  // FLOW-348 A: with no key on the server the switch is locked off, so the tally says off too.
  const jevOn = jev.data != null && jevSwitchOn({ ...jev.data, status: "ready" });
  const jevKeyMissing = useJevKeyStatusQuery(liveCompany && jevOn).data === "missing";
  const assistant = useAssistantStatusQuery(liveCompany);
  const categories = useCategoriesQuery(liveCompany);
  const companies = useMyCompaniesQuery(sample == null);
  // FLOW-502: a build without the VAPID key has no התראות row and reads nothing.
  const pushShown = sample != null || pushConfigured();
  const notificationsQuery = useNotificationPrefsQuery(sample == null && preview === "off" && pushShown);
  const [themeOpen, setThemeOpen] = useState(false);
  const themeRowRef = useRef<HTMLButtonElement>(null);
  // FLOW-372: the appearance is this phone's, saved per device (Settings › מראה).
  const [theme, setTheme] = useState<ThemeChoice>(readThemeChoice);
  const pickTheme = (next: ThemeChoice) => {
    writeThemeChoice(next);
    setTheme(next);
  };
  const themeHint = themeChoiceLabel(theme);
  const [companyOpen, setCompanyOpen] = useState(false);
  const setCompanySheet = useSheetHistory("company", companyOpen, setCompanyOpen);
  const companyRowRef = useRef<HTMLButtonElement>(null);
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
      queryClient.removeQueries({ queryKey: [MY_COMPANIES_KEY] });
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
  const email = (sample ? sample.email : previewSample ? previewAccountEmail : session?.user.email)?.trim() ?? "";
  const namedBusiness = (businessName ?? "").trim();
  const showInstall = !isStandalone();
  const showSignOut = preview === "off" || previewValue === "empty";
  // The role word under the email line (board: "owner@example.com · בעלים").
  const liveRole = role === "owner" || role === "editor" || role === "viewer" ? ROLE_LABEL[role] : null;
  const roleWord = sample ? ROLE_LABEL[sample.role ?? "owner"] : previewSample ? ROLE_LABEL.owner : liveRole;
  const subtitle = [email, roleWord].filter((part) => part != null && part !== "").join(" · ");

  const tallies: ConnectorTally[] = sample
    ? [
      { name: "SUMIT", state: sample.sumit ?? (sample.lastError === "sumit_auth" ? "reconnect" : sample.connected ? "active" : "off") },
      { name: "Mercury", state: sample.mercury ?? (sample.mercuryLastError === "auth" ? "reconnect" : sample.mercuryConnected === true ? "active" : "off") },
      { name: "תיוג חכם", state: (() => {
        const state = sample.jev ?? JEV_DEFAULT;
        if (state.status === "loading" || state.status === "error") return state.status;
        return jevSwitchOn(state) && !jevLocked(state) ? "active" : "off";
      })() },
      { name: "AI", state: assistantTally(sample.assistant ?? { state: "empty" }) },
    ]
    : [
      queryTally("SUMIT", sumit, () => (sumit.data?.last_error === "sumit_auth" ? "reconnect" : sumit.data?.connected === true ? "active" : "off")),
      queryTally("Mercury", mercury, () => (mercury.data?.last_error === "auth" ? "reconnect" : mercury.data?.connected === true ? "active" : "off")),
      queryTally("תיוג חכם", jev, () => (jevOn && !jevKeyMissing ? "active" : "off")),
      queryTally("AI", assistant, () => {
        const state = assistant.data?.state;
        return state === "connected" ? "active" : state === "expired" ? "reconnect" : "off";
      }),
    ];
  // A viewer or an editor cannot reconnect, so an expired connector reads as off (V29).
  const hint = connectionsHint(holdOwner
    ? tallies.map((item) => (item.state === "reconnect" ? { ...item, state: "off" as const } : item))
    : tallies);
  const connectionsValue: ReactNode = noCompany
    ? "אין עסק עדיין"
    : hint.kind === "loading"
      ? <Skeleton width="sm" />
      : hint.kind === "error"
        ? "לא הצלחנו לטעון"
        : hint.kind === "attention"
          ? <span className="ui-row-value-signal">{hint.text}</span>
          : <><bdi className="ui-num" dir="ltr">{String(hint.active)}</bdi> פעילים</>;

  // FLOW-601: the owner's צוות row, with how many people are on the team.
  // Undefined hides the row; null shows it without a count (still loading, or the read failed).
  const teamCount: number | null | undefined = holdOwner
    ? undefined
    : sample
      ? sample.teamCount
      : live && liveCompany
        ? (team.data?.members.length ?? null)
        : undefined;
  // FLOW-502: per user, so it shows without a company too. A preview reads the sample, never the server.
  const notificationsSample = sample ? (sample.notifications ?? NO_PREFS) : preview !== "off" ? NO_PREFS : undefined;
  const notificationsData = notificationsSample ?? notificationsQuery.data;
  const notificationsLoading = notificationsSample == null && notificationsQuery.isPending;
  const categoryCount = sample ? sample.categoryCount : live && liveCompany ? (categories.data?.filter((row) => !row.hidden).length ?? null) : undefined;
  const categoriesLoading = sample == null && liveCompany && categories.isPending;
  const companyCount = sample ? sample.companyCount : companies.data?.companies.length;
  const setupLeft = setupEntry != null ? Math.max(0, 5 - setupEntry.done) : null;

  return (
    <ViewerScope>
    <div>
      <ScreenHeader title="הגדרות" backTo="/" backText="בית" subtitle={subtitle} />
      <ViewerNote />
      {noCompany ? null : (
        <List layout="inset">
          {namedBusiness !== "" ? (
            <SettingsPageRow
              page="business"
              href={`/settings/business${search}`}
              title="העסק"
              icon={<BuildingIcon />}
              value={namedBusiness}
            />
          ) : null}
          <SettingsPageRow
            page="connections"
            href={`/settings/connections${search}`}
            title="חיבורים"
            icon={<PlugIcon />}
            value={connectionsValue}
            skeleton={hint.kind === "loading"}
          />
          {teamCount !== undefined ? (
            <SettingsPageRow
              page="team"
              href={`/settings/team${search}`}
              title="צוות"
              icon={<PeopleIcon />}
              value={teamCount == null ? undefined : <bdi className="ui-num" dir="ltr">{String(teamCount)}</bdi>}
            />
          ) : null}
          {pushShown ? (
            <SettingsPageRow
              page="notifications"
              href={`/settings/notifications${search}`}
              title="התראות"
              icon={<BellIcon />}
              value={notificationsData != null ? notificationsHint(notificationsData) : undefined}
              skeleton={notificationsLoading}
            />
          ) : null}
          <SettingsPageRow
            page="categories"
            href={`/settings/categories${search}`}
            title="קטגוריות"
            icon={<TagIcon />}
            value={categoriesLoading ? undefined : categoryCount == null ? undefined : <bdi className="ui-num" dir="ltr">{String(categoryCount)}</bdi>}
            skeleton={categoriesLoading}
          />
        </List>
      )}
      <ThemeSheet open={themeOpen} onOpenChange={setThemeOpen} value={theme} onChange={pickTheme} returnFocusRef={themeRowRef} />
      <CompanySheet
        open={companyOpen}
        onOpenChange={setCompanySheet}
        onLeave={() => { setCompanyOpen(false); }}
        returnFocusRef={companyRowRef}
      />
      <List layout="inset">
        <ListRow
          variant="button"
          title={THEME_TITLE}
          value={themeHint}
          label={`${THEME_TITLE}: ${themeHint}`}
          icon={<ThemeIcon />}
          chevron
          buttonRef={themeRowRef}
          onClick={() => { setThemeOpen(true); }}
        />
        {noCompany || companyCount == null ? null : (
          <ListRow
            variant="button"
            title="החלפת עסק"
            value={<><bdi className="ui-num" dir="ltr">{String(companyCount)}</bdi> עסקים</>}
            icon={<TransferIcon />}
            chevron
            buttonRef={companyRowRef}
            onClick={() => { setCompanySheet(true); }}
          />
        )}
        {showInstall ? (
          <ListRow variant="item" href={`/install${search}`} title="התקנה למסך הבית" icon={<DownloadIcon />} chevron />
        ) : null}
        {setupEntry && !holdOwner ? (
          <ListRow
            variant="item"
            href={setupEntry.href}
            title="הגדרה ראשונה"
            icon={<SparkIcon />}
            value={setupLeft == null ? undefined : `${String(setupLeft)} להשלמה`}
            chevron
          />
        ) : null}
      </List>
      {showSignOut ? (
        <div className="ui-settings-signout">
          <Button variant="danger-link" busy={signOut.isPending} onClick={() => { signOut.mutate(); }}>
            התנתקות
          </Button>
        </div>
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
  value,
  skeleton = false,
}: {
  page: SettingsPage;
  href: string;
  title: string;
  icon: ReactNode;
  value?: ReactNode;
  skeleton?: boolean;
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
        value={skeleton ? <Skeleton width="sm" /> : value}
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

