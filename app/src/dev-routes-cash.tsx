import { useNavigate, useSearchParams } from "react-router-dom";
import { attentionRows, CashEmptyHome, CashHome } from "./screens/HomeScreen";
import { chargeChangeViews } from "./forecast";
import { CashLinesScreen, CashMonthScreen } from "./screens/cash-screens";
import { sampleCashLines, sampleCashMonths, sampleCashToDay, sampleCashUsdLoss, sampleCashUsdToDay, sampleCashUsdYear, sampleCashYearMonths, sampleCashYears } from "./dev/cash-sample";
import { CashHistoryScreen, CashYearScreen } from "./screens/cash-history";
import { cashMonthKey } from "./cash";
import { BandCompany } from "./ui/top-band";
import { SAMPLE_MISSING_BILLS, SAMPLE_RECURRING_CHANGES } from "./forecast-sample";

export function DevCash() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
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
        unpaidGross: 460_000n,
        // FLOW-415: `?recurring=1` adds the late bills and a charge above its usual amount.
        missingCount: params.get("recurring") === "1" ? SAMPLE_MISSING_BILLS.length : 0,
        missingTo: "/e2e/missing-bills",
        changes: params.get("recurring") === "1" ? chargeChangeViews(SAMPLE_RECURRING_CHANGES, "?preview=1") : [],
        search: "?preview=1",
      })}
      sameDay={usdLoss ? (past ? null : sampleCashUsdToDay()) : sampleCashToDay()}
      forecast={usdLoss ? -570_000n : -6_810_000n}
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

/** FLOW-413: the earlier month's cash page. */
export function DevCashMonth() {
  const data = sampleCashMonths();
  return <CashMonthScreen sample={data} monthKey={cashMonthKey(data.months[1]?.month ?? "")} />;
}

/** FLOW-413: this month's יצא lines; `?side=in` shows נכנס, `?side=kept` לא נספר ברווח (FLOW-418). */
export function DevCashLines() {
  const [params] = useSearchParams();
  const asked = params.get("side");
  const side = asked === "in" || asked === "kept" ? asked : "out";
  const data = sampleCashMonths();
  return (
    <CashLinesScreen
      sample={{ months: data, lines: sampleCashLines(side) }}
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
