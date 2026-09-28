import { allocateByWeights, formatIls, homeSummarySchema, type Dashboard, type ProjectRow } from "@flow/shared";
import { onlineManager, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { ChartIcon } from "../ui/icons";
import { HomeSkeleton } from "../ui/skeleton";
import { BigNumber } from "../ui/big-number";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { ErrorState } from "../ui/error-state";
import { ListRow } from "../ui/list-row";
import { PeriodPicker } from "../ui/period-picker";
import { SegmentedControl } from "../ui/segmented-control";
import { Toggle } from "../ui/toggle";
import { TopBand } from "../ui/top-band";
import { homeGreeting, profitBandLabel } from "../home-label";
import { getSupabase } from "../lib/supabase";
import { allTime, lastMonth, thisMonth, yearToDate } from "../period";
import { previewHidesBand, useHomePreview, usePreviewSearch } from "../preview";
import { useBooks, useDashboardQuery, useUnpaidQuery } from "../use-books";

function readOwnerName(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const fullName = "full_name" in metadata ? metadata.full_name : undefined;
  const name = "name" in metadata ? metadata.name : undefined;
  const raw = fullName ?? name;
  return typeof raw === "string" ? raw : null;
}

function ag(value: number): bigint {
  return BigInt(Math.trunc(value));
}

function changeLabel(current: number, previous: number | null, helpsWhenUp: boolean): { text: string; good: boolean } | null {
  if (previous == null || previous === 0) return null;
  const pct = Math.round(((current - previous) / Math.abs(previous)) * 100);
  if (pct === 0) return null;
  const up = pct > 0;
  return { text: `${up ? "▲" : "▼"} ${String(Math.abs(pct))}%`, good: helpsWhenUp ? up : !up };
}

export function HomeScreen() {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const navigate = useNavigate();
  const { status, session } = useAuth();
  const supabase = getSupabase();
  const previewing = preview !== "off";
  const books = useBooks();
  const dashboard = useDashboardQuery();
  const unpaid = useUnpaidQuery();

  const home = useQuery({
    queryKey: ["home"],
    enabled: !previewing && status === "authed" && supabase != null,
    queryFn: async () => {
      if (!supabase) return null;
      const { data, error } = await supabase.rpc("get_home");
      if (error) throw error;
      return homeSummarySchema.parse(data);
    },
  });

  const showBooks = preview === "demo" || (!previewing && dashboard.data != null && hasBooks(dashboard.data));
  const loading =
    preview === "loading" ||
    (!previewing && (status === "loading" || ((home.isLoading || dashboard.isLoading) && !showBooks)));
  const liveOffline =
    !previewing &&
    (home.isPaused || dashboard.isPaused || ((home.isError || dashboard.isError) && !onlineManager.isOnline()));
  const liveServer =
    !previewing &&
    (home.isError || dashboard.isError) &&
    !home.isPaused &&
    !dashboard.isPaused &&
    onlineManager.isOnline();
  const offline = preview === "error" || liveOffline;
  const failed = previewHidesBand(preview) || liveOffline || liveServer;
  const greeting = homeGreeting(preview === "demo" ? "אלירן" : readOwnerName(session?.user.user_metadata));

  useEffect(() => {
    if (!failed && showBooks) {
      document.documentElement.dataset.band = "on";
      return () => {
        delete document.documentElement.dataset.band;
      };
    }
    if (!failed) return;
    document.documentElement.dataset.band = "off";
    return () => {
      delete document.documentElement.dataset.band;
    };
  }, [failed, showBooks]);

  function retry() {
    if (previewing) {
      void navigate(preview === "demo" ? "/?preview=demo" : "/?preview=1");
      return;
    }
    void home.refetch();
    void dashboard.refetch();
  }

  if (loading) return <HomeSkeleton previewing={previewing} />;

  if (failed) {
    return <ErrorState offline={offline} onRetry={retry} />;
  }

  if (!showBooks || !dashboard.data) {
    return (
      <div className="flex min-h-full flex-1 flex-col">
        <TopBand preview={previewing}>
          <div className="band-hero">
            <p className="t-title-2">{greeting}</p>
            <h1 className="band-label t-label">{profitBandLabel(false)}</h1>
          </div>
        </TopBand>
        <EmptyState
          icon={<ChartIcon />}
          title="עוד אין נתונים"
          body="הרווח יופיע כאן אחרי ש-SUMIT מחובר."
          action={
            <Button variant="secondary" to={`/settings${search}`}>
              חיבור SUMIT
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <HomeBooks
      data={dashboard.data}
      greeting={greeting}
      previewing={previewing}
      search={search}
      unpaidNet={unpaid.data?.reduce((sum, row) => sum + row.open_net_agorot, 0) ?? 0}
      unpaidCount={unpaid.data?.length ?? 0}
      periodLabel={books.period.label}
      basis={books.period.basis}
      overheadOn={books.overheadOn}
      onOverhead={books.setOverheadOn}
      onPeriod={(choice) => {
        books.setPeriod({ ...choice, basis: books.period.basis });
      }}
      onBasis={(basis) => {
        books.setPeriod({ ...books.period, basis });
      }}
    />
  );
}

function hasBooks(data: Dashboard): boolean {
  return data.projects.length > 0 || data.income_agorot !== 0 || data.expense_agorot !== 0;
}

function HomeBooks({
  data,
  greeting,
  previewing,
  search,
  unpaidNet,
  unpaidCount,
  periodLabel,
  basis,
  overheadOn,
  onOverhead,
  onPeriod,
  onBasis,
}: {
  data: Dashboard;
  greeting: string;
  previewing: boolean;
  search: string;
  unpaidNet: number;
  unpaidCount: number;
  periodLabel: string;
  basis: "cash" | "invoiced";
  overheadOn: boolean;
  onOverhead: (on: boolean) => void;
  onPeriod: (choice: ReturnType<typeof thisMonth>) => void;
  onBasis: (basis: "cash" | "invoiced") => void;
}) {
  const [sheet, setSheet] = useState(false);
  const rows = [...data.projects].sort(
    (a, b) => Math.abs(b.income_agorot) + Math.abs(b.direct_agorot) - (Math.abs(a.income_agorot) + Math.abs(a.direct_agorot)),
  );
  const top = rows.slice(0, 5);
  const rest = rows.slice(5);
  const restProfit = rest.reduce((sum, row) => sum + row.profit_agorot, 0);
  const shares = overheadShares(data, overheadOn);
  const incomeChange = changeLabel(data.income_agorot, data.prev_income_agorot, true);
  const expenseChange = changeLabel(data.expense_agorot, data.prev_expense_agorot, false);
  const profitChange = changeLabel(data.net_profit_agorot, data.prev_net_agorot, true);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <TopBand
        preview={previewing}
        trailing={
          <PeriodPicker
            pill={periodLabel}
            open={sheet}
            onOpenChange={setSheet}
            options={[
              { label: "החודש", onSelect: () => { onPeriod(thisMonth()); } },
              { label: "חודש קודם", onSelect: () => { onPeriod(lastMonth()); } },
              { label: "מתחילת השנה", onSelect: () => { onPeriod(yearToDate()); } },
              { label: "כל התקופה", onSelect: () => { onPeriod(allTime(basis)); } },
            ]}
            footer={
              <SegmentedControl
                label="בסיס"
                value={basis}
                onChange={onBasis}
                options={[
                  { value: "cash", label: "מזומן" },
                  { value: "invoiced", label: "חשבוניות" },
                ]}
              />
            }
          />
        }
      >
        <div className="band-hero">
          <p className="t-title-2">{greeting}</p>
          <p className="band-label t-label">
            {basis === "cash" ? "רווח נקי במזומן" : "רווח נקי לפי חשבוניות"} · {data.name}
          </p>
          <h1 className="t-hero">
            <BigNumber agorot={ag(data.net_profit_agorot)} />
          </h1>
        </div>
      </TopBand>

      <div className="stat-grid">
        <Stat label="הכנסות" amount={data.income_agorot} change={incomeChange} />
        <Stat label="הוצאות" amount={data.expense_agorot} change={expenseChange} />
        <Stat label="רווח/הפסד" amount={data.net_profit_agorot} change={profitChange} emphasis />
      </div>

      {data.review_count > 0 ? (
        <Link to={`/review${search}`} className="pending-banner">
          <span className="count-badge">{data.review_count}</span>
          {data.review_count} פריטים ממתינים לאישור
        </Link>
      ) : null}

      {unpaidCount > 0 ? (
        <Link to={`/unpaid${search}`} className="quiet-line">
          {unpaidCount} חשבוניות לא שולמו · <bdi dir="ltr">{formatIls(ag(unpaidNet))}</bdi>
          <span className="t-hint"> לא נכלל ברווח</span>
        </Link>
      ) : null}

      <div className="section-head">
        <h2 className="t-title-3">פרויקטים</h2>
        <Toggle label="רווח אחרי חלק מהתקורה" checked={overheadOn} onChange={onOverhead} />
      </div>
      {overheadOn && shares == null ? (
        <p className="t-hint page-pad">אין הכנסות בתקופה, אז אי אפשר לחלק את התקורה.</p>
      ) : null}
      <ul className="project-list">
        {top.map((project) => (
          <ProjectLine key={project.id} project={project} search={search} share={shares?.get(project.id) ?? null} overheadOn={overheadOn} />
        ))}
        {rest.length > 0 ? (
          <li>
            <ListRow
              variant="project"
              title={`עוד ${String(rest.length)} פרויקטים`}
              agorot={ag(restProfit)}
              loss={restProfit < 0}
              href={`/projects${search}`}
            />
          </li>
        ) : null}
        <li className={overheadOn ? "overhead-struck" : "overhead-row"}>
          <ListRow
            variant="project"
            title={`הוצאות כלליות · תקורה${overheadOn ? " · חולק לפרויקטים בתצוגה הזו" : ""}`}
            agorot={ag(-data.overhead_agorot)}
            loss={data.overhead_agorot > 0}
          />
        </li>
      </ul>
    </div>
  );
}

function Stat({
  label,
  amount,
  change,
  emphasis = false,
}: {
  label: string;
  amount: number;
  change: { text: string; good: boolean } | null;
  emphasis?: boolean;
}) {
  return (
    <div className={emphasis ? "stat stat-em" : "stat"}>
      <p className="t-hint">{label}</p>
      <p className="t-title-3">
        <BigNumber agorot={ag(amount)} />
      </p>
      {change ? <p className={change.good ? "delta good" : "delta bad"}>{change.text}</p> : null}
    </div>
  );
}

function ProjectLine({
  project,
  search,
  share,
  overheadOn,
}: {
  project: ProjectRow;
  search: string;
  share: number | null;
  overheadOn: boolean;
}) {
  const shown = overheadOn && share != null ? project.profit_before_shared_agorot - share : project.profit_agorot;
  const hint = overheadOn && share != null
    ? `לפני ${formatIls(ag(project.profit_before_shared_agorot))} · חלק ${formatIls(ag(share))}`
    : undefined;
  return (
    <li>
      <ListRow
        variant="project"
        title={project.name}
        hint={hint}
        agorot={ag(shown)}
        loss={shown < 0}
        href={`/projects/${project.id}${search}`}
      />
    </li>
  );
}

function overheadShares(data: Dashboard, on: boolean): Map<string, number> | null {
  if (!on) return null;
  const weights = data.projects.map((project) => Math.max(0, Math.trunc(project.income_agorot)));
  if (weights.every((weight) => weight === 0)) return null;
  const parts = allocateByWeights(ag(data.overhead_agorot), weights);
  const map = new Map<string, number>();
  data.projects.forEach((project, index) => {
    map.set(project.id, Number(parts[index] ?? 0n));
  });
  return map;
}
