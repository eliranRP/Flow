import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { type Dashboard } from "@flow/shared";
import { defaultPeriod } from "../../period";
import { BackButton } from "../../ui/back";
import { BandCompany } from "../../ui/top-band";
import { attentionRows, CashEmptyHome, CashHome, HomeBooks } from "../../screens/HomeScreen";
import { CashHomeSkeleton } from "../../screens/home-skeleton";
import { chargeChangeViews } from "../../forecast";
import { CashLinesScreen } from "../../screens/cash-lines-screen";
import { CashMonthScreen } from "../../screens/cash-screens";
import {
  sampleBoardCashLines,
  sampleBoardCashMonths,
  sampleCashLines,
  sampleCashLinesFlagged,
  sampleCashMonths,
  sampleCashToDay,
  sampleCashUsdLoss,
  sampleCashUsdToDay,
  sampleCashUsdYear,
  sampleCashYearMonths,
  sampleCashYears,
} from "../cash-sample";
import { CashHistoryScreen, CashYearScreen } from "../../screens/cash-history";
import { cashMonthKey } from "../../cash";
import { SAMPLE_MISSING_BILLS, SAMPLE_RECURRING_CHANGES } from "../../forecast-sample";
import type { DevRoute } from "./types";

export const devDashboard: Dashboard = {
  company_id: "e2e",
  name: "בדיקה",
  vat_registered: true,
  basis: "cash",
  from: "2026-09-01",
  to: "2026-09-29",
  income_agorot: 1_000n,
  direct_agorot: 400n,
  shared_agorot: 0n,
  overhead_agorot: 0n,
  expense_agorot: 400n,
  net_profit_agorot: 600n,
  prev_income_agorot: null,
  prev_expense_agorot: null,
  prev_net_agorot: null,
  active_projects: 2,
  review_count: 2,
  after_overhead: false,
  by_currency: [],
  projects: [
    { id: "p1", name: "שיפוץ הרצל 12", status: "active", income_agorot: 1_000n, direct_agorot: 400n, shared_agorot: 0n, profit_before_shared_agorot: 600n, profit_agorot: 600n, by_currency: [] },
    { id: "p2", name: "וילה רעננה", status: "active", income_agorot: 0n, direct_agorot: 0n, shared_agorot: 0n, profit_before_shared_agorot: 0n, profit_agorot: 0n, by_currency: [] },
    { id: "p3", name: "פרויקט ישן", status: "finished", income_agorot: 0n, direct_agorot: 0n, shared_agorot: 0n, profit_before_shared_agorot: 0n, profit_agorot: 0n, by_currency: [] },
  ],
};

export function DevHome() {
  const [period, setPeriod] = useState(defaultPeriod());
  const [params] = useSearchParams();
  return (
    <HomeBooks
      // FLOW-413: `?back=1` draws the profit view as /profit opens it, with its way back to the cash.
      back={params.get("back") === "1" ? <BackButton fallback="/e2e/cash" onBand text="תזרים" label="חזרה לתזרים" /> : undefined}
      data={devDashboard}
      previewing
      search="?preview=1"
      unpaidGross={50_000n}
      unpaidCount={1}
      missingCount={SAMPLE_MISSING_BILLS.length}
      missingTo="/e2e/recurring"
      period={period}
      onPeriod={setPeriod}
    />
  );
}

/**
 * FLOW-413: Home's cash with invented figures (frame b). `?box=none` hides the attention box,
 * as a month with nothing waiting does. FLOW-374: `?scrolled=1` scrolls the page to the board's 328px, as the
 * FlowScrolled frame is.
 */
/** The usd-loss board's changed charge: an insurance charge up 27% (the board's $1,240 against its usual $980). */
const SAMPLE_USD_CHANGES = SAMPLE_RECURRING_CHANGES.slice(0, 1).map((change) => ({
  ...change,
  supplier_name: "ביטוח הנכס",
  category_name: "ביטוח הנכס",
  currency: "USD",
  amount_minor: -124_000n,
  typical_amount_minor: -98_000n,
  change_percent: 27,
}));

export function DevCash() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  useEffect(() => {
    if (params.get("scrolled") !== "1") return;
    const frame = requestAnimationFrame(() => { window.scrollTo(0, 328); });
    return () => { cancelAnimationFrame(frame); };
  }, [params]);
  // FLOW-364: `?state=usd-loss` is the board's negative month in dollars (its past frame with `?month=past`).
  const usdLoss = params.get("state") === "usd-loss";
  const past = params.get("month") === "past";
  const data = usdLoss ? sampleCashUsdLoss(past) : sampleCashMonths();
  const currentKey = cashMonthKey(data.months[0]?.month ?? "");
  // The board's drawer lists the year from January; the usd-loss year carries those months.
  const yearMonths = usdLoss ? sampleCashUsdYear() : undefined;
  // FLOW-364: `?month=past` shows the previous month (the darker band); `?drawer=1` opens the month drawer.
  const monthKey = past ? cashMonthKey(data.months[1]?.month ?? "") : currentKey;
  return (
    <CashHome
      data={data}
      monthKey={monthKey}
      currentKey={currentKey}
      firstKey={cashMonthKey(yearMonths?.months[0]?.month ?? data.months.at(-1)?.month ?? currentKey)}
      previewing={false}
      search="?preview=1"
      attention={params.get("box") === "none" ? [] : attentionRows({
        pending: 7,
        unpaidCount: 3,
        // The usd-loss board frame's invoices and its charge are in dollars (the board's $21,300 and $1,240).
        unpaidGross: usdLoss ? 2_130_000n : 460_000n,
        currency: usdLoss ? "USD" : "ILS",
        // FLOW-415: `?recurring=1` adds the late bills and a charge above its usual amount.
        missingCount: params.get("recurring") === "1" ? SAMPLE_MISSING_BILLS.length : 0,
        missingTo: "/e2e/recurring",
        changes: params.get("recurring") === "1" ? chargeChangeViews(usdLoss ? SAMPLE_USD_CHANGES : SAMPLE_RECURRING_CHANGES, "?preview=1") : [],
        search: "?preview=1",
      })}
      sameDay={usdLoss ? (past ? null : sampleCashUsdToDay()) : sampleCashToDay()}
      forecast={usdLoss ? -574_100n : -6_810_000n}
      company={<BandCompany name="Acme Test Co" onOpen={() => { void navigate("/settings?preview=1"); }} />}
      onStepMonth={(key) => {
        void navigate(`/e2e/cash?month=${key}`, { replace: true });
      }}
      initialDrawerOpen={params.get("drawer") === "1"}
      drawerYearMonths={yearMonths}
    />
  );
}

/** FLOW-364 (board, StatesHomeEmpty): the signed-in company with no books yet, in dollars, not preview. */
export function DevCashEmpty() {
  const navigate = useNavigate();
  return (
    <CashEmptyHome
      leading={<BandCompany name="Acme Test Co" onOpen={() => { void navigate("/settings?preview=1"); }} />}
      search="?preview=1"
      holdWrites={false}
      currency="USD"
      avatarInitial="A"
    />
  );
}

/** FLOW-375 (board, States homeLoading and homeReveal): the cash Home while it loads. */
export function DevCashLoading() {
  return <CashHomeSkeleton />;
}

/** FLOW-413: the earlier month's cash page. */
export function DevCashMonth() {
  const data = sampleCashMonths();
  return <CashMonthScreen sample={data} monthKey={cashMonthKey(data.months[1]?.month ?? "")} />;
}

/** FLOW-413: this month's יצא lines; `?side=in` shows נכנס, `?side=kept` לא נספר ברווח (FLOW-418). FLOW-366: `?order=` and `?pending=1`. */
export function DevCashLines() {
  const [params] = useSearchParams();
  const asked = params.get("side");
  const side = asked === "in" || asked === "kept" ? asked : "out";
  // FLOW-366: ?pending=1 flags the first line for review and the second as out of profit.
  const flagged = params.get("pending") === "1";
  if (params.get("board") === "1") {
    // The board frame: an invented USD company with the board's amounts and pending rows, dated as the board
    // draws them (today is 11/10 there), so the day titles and the rows' dates match the frame.
    const boardToday = new Date(2026, 9, 11, 12);
    const board = sampleBoardCashMonths(boardToday);
    // The board draws only the יצא and נכנס rows, so a לא נספר request shows the יצא rows.
    const boardSide = side === "in" ? "in" : "out";
    return (
      <CashLinesScreen
        sample={{ months: board, lines: sampleBoardCashLines(boardSide, boardToday), today: "2026-10-11" }}
        at={{ month: cashMonthKey(board.months[0]?.month ?? ""), side: boardSide, currency: "USD" }}
      />
    );
  }
  const data = sampleCashMonths();
  return (
    <CashLinesScreen
      sample={{ months: data, lines: flagged ? sampleCashLinesFlagged(side) : sampleCashLines(side) }}
      at={{ month: cashMonthKey(data.months[0]?.month ?? ""), side, currency: "ILS" }}
    />
  );
}

/** FLOW-417: the cash history, years then months. `?currencies=two` adds a USD line. */
export function DevCashHistory() {
  const [params] = useSearchParams();
  return <CashHistoryScreen sample={sampleCashYears(new Date(), params.get("currencies") === "two" ? "two" : "one")} />;
}

/** FLOW-417: last year's page: its net, נכנס, יצא and its months. */
export function DevCashYear() {
  const months = sampleCashYearMonths();
  return <CashYearScreen sample={{ years: sampleCashYears(), months }} year={Number(months.months[0]?.month.slice(0, 4))} />;
}

export const homeRoutes: DevRoute[] = [
  { path: "home", element: <DevHome /> },
  { path: "cash", element: <DevCash /> },
  { path: "cash-empty", element: <DevCashEmpty /> },
  { path: "cash-loading", element: <DevCashLoading /> },
  { path: "cash-month", element: <DevCashMonth /> },
  { path: "cash-lines", element: <DevCashLines /> },
  { path: "cash-history", element: <DevCashHistory /> },
  { path: "cash-year", element: <DevCashYear /> },
];
