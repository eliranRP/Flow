import { formatAmountText, type ForecastBuild, type ForecastItem } from "@flow/shared";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { cashMonthKey, cashRows } from "../cash";
import { daysLeftInMonth, type ForecastPatch, type MonthForecast, priorPatch, useMonthForecastQuery, useResetForecastMonth, useSetForecastItem } from "../forecast-month";
import { useCashMonthsQuery } from "../use-cash";
import { israelToday } from "../ui/date-math";
import { ScreenHeader } from "../ui/screen-header";
import { DelayedSkeleton, ListSkeleton } from "../ui/skeleton";
import { EmptyState } from "../ui/empty-state";
import { useToast } from "../ui/toast";
import { ForecastItemSheet } from "./forecast-sheet";
import { monthName } from "./home-parts";
import { Amount } from "../ui/amount";
import { cx } from "../ui/cx";

/**
 * A story's data: the builder's output and the cash net today, both in the base's minor units.
 * `base` is the currency the builder counted (ILS for the app; a sample may use another).
 */
export type ForecastSample = { data: MonthForecast; net: bigint; today: string; base?: string };

/** The page scrolls past this many pixels: the compact bar slides down (FLOW-141). */
const COMPACT_AFTER = 150;
/** The moved row folds away this long before its write, then the list is refreshed. */
const FOLD_MS = 280;

function signed(minor: bigint, sign: "+" | "−" | "", currency: string): string {
  const text = formatAmountText(minor < 0n ? -minor : minor, currency);
  return `${sign}${text}`;
}

/** The big number: the sign is U+2212 when it is negative, as Home's line writes it. */
export function forecastBigText(minor: bigint, currency = "ILS"): string {
  return minor < 0n ? signed(minor, "−", currency) : formatAmountText(minor, currency);
}

function itemWhen(item: ForecastItem): string {
  if (item.due_on != null) return `עד ${String(Number(item.due_on.slice(8, 10)))}.${String(Number(item.due_on.slice(5, 7)))}`;
  if (item.kind === "invoice") return item.direction === "income" ? "לגבייה" : "לתשלום";
  return item.day != null ? `ב־${String(item.day)}` : "השבוע";
}

function itemWhat(item: ForecastItem): string {
  return item.kind === "invoice" ? "חשבונית" : "קבוע";
}

function ForecastRowButton({ item, onOpen, leaving }: { item: ForecastItem; onOpen: (item: ForecastItem) => void; leaving: boolean }) {
  const name = item.name === "" ? "ללא שם" : item.name;
  const amount = item.direction === "income" ? signed(item.minor, "+", item.currency) : signed(item.minor, "−", item.currency);
  const figure = <Amount agorot={item.minor} size="list" currency={item.currency} direction={item.direction} income={item.direction === "income"} />;
  return (
    <li className={cx("ui-forecast-li", leaving && "ui-forecast-leaving")}>
      <button type="button" className="ui-forecast-row" onClick={() => { onOpen(item); }} aria-label={`${name}, ${amount}`}>
        <span className="ui-forecast-initial" aria-hidden="true">{name.slice(0, 1)}</span>
        <span className="ui-forecast-text">
          <span className="ui-forecast-name">{name}</span>
          <span className="ui-forecast-meta">{`${itemWhat(item)} · ${itemWhen(item)}`}</span>
        </span>
        <span className={cx("ui-forecast-amount", item.overridden && "ui-forecast-edited")}>{figure}</span>
      </button>
    </li>
  );
}

function ForecastSection({
  title,
  total,
  items,
  onOpen,
  leavingKey,
}: {
  title: string;
  total: ReactNode;
  items: readonly ForecastItem[];
  onOpen: (item: ForecastItem) => void;
  leavingKey: string | null;
}) {
  return (
    <section className="ui-forecast-section">
      <h2 className="ui-forecast-section-head">
        <span>{title}</span>
        <span className="ui-forecast-section-total">{total}</span>
      </h2>
      <ul className="ui-forecast-list">
        {items.map((item) => (
          <ForecastRowButton key={item.key} item={item} onOpen={onOpen} leaving={leavingKey === item.key} />
        ))}
      </ul>
    </section>
  );
}

export function ForecastScreen({ sample }: { sample?: ForecastSample } = {}) {
  const toast = useToast();
  const live = sample == null;
  const today = sample?.today ?? israelToday();
  const month = today.slice(0, 7);
  const query = useMonthForecastQuery(month, live);
  const cash = useCashMonthsQuery();
  const write = useSetForecastItem(month);
  const reset = useResetForecastMonth(month);
  const [open, setOpen] = useState<ForecastItem | null>(null);
  const [smallOpen, setSmallOpen] = useState(false);
  const [leavingKey, setLeavingKey] = useState<string | null>(null);
  const [compact, setCompact] = useState(false);

  const data = sample?.data ?? query.data ?? null;
  const base = sample?.base ?? "ILS";
  const currentRow = cash.data?.months.find((row) => cashMonthKey(row.month) === month);
  const net = sample?.net ?? cashRows(currentRow, base).find((row) => row.currency === base)?.net_minor ?? 0n;
  const build: ForecastBuild | null = data?.build ?? null;
  const total = build == null ? 0n : net + build.incomeTotal - build.expenseTotal;
  const days = daysLeftInMonth(today, month);

  useEffect(() => {
    const onScroll = () => { setCompact(window.scrollY > COMPACT_AFTER); };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); };
  }, []);

  const smallTotal = build == null ? 0n : build.small.reduce((sum, item) => sum + item.minor, 0n);
  const changed = build?.changed ?? 0;

  function save(item: ForecastItem, patch: ForecastPatch) {
    const prior = data?.overrides.find((row) => row.item_key === item.key) ?? null;
    if (patch.moved_out) {
      setLeavingKey(item.key);
      window.setTimeout(() => {
        setLeavingKey(null);
        write.mutate({ key: item.key, patch, undo: false, prior });
      }, FOLD_MS);
      toast.show({
        message: `${item.name} הועבר לחודש הבא`,
        action: "ביטול",
        onAction: () => { write.mutate({ key: item.key, patch: priorPatch(prior), undo: true, prior }); },
      });
      return;
    }
    write.mutate({ key: item.key, patch, undo: false, prior });
    toast.show({
      message: "הצפי עודכן",
      action: "ביטול",
      onAction: () => { write.mutate({ key: item.key, patch: priorPatch(prior), undo: true, prior }); },
    });
  }

  function resetAll() {
    reset.mutate(undefined, {
      onSuccess: () => toast.show({ message: "הצפי חזר למספרים של Flow" }),
    });
  }

  const income = build?.income ?? [];
  const expense = build?.expense ?? [];
  const moved = build?.moved ?? [];

  return (
    <div className="ui-forecast-screen">
      <div className={cx("ui-forecast-compact", compact && "ui-forecast-compact-on")} aria-hidden={!compact}>
        <span>בית</span>
        <span className="ui-forecast-compact-figure">צפי · <bdi dir="ltr">{forecastBigText(total, base)}</bdi></span>
      </div>
      <ScreenHeader title="צפי" backTo="/" backText="בית" subtitle={`סוף ${monthName(month)} · עוד ${String(days)} ימים`} />
      {data == null && live && query.isError ? (
        <p className="ui-forecast-error t-hint" role="alert">לא הצלחנו לטעון את הצפי.</p>
      ) : null}
      {data == null && !query.isError ? (
        <DelayedSkeleton>
          <ListSkeleton />
        </DelayedSkeleton>
      ) : null}
      {build == null ? null : (
        <>
          <p className={cx("ui-forecast-big", total < 0n && "ui-forecast-big-neg")} aria-label="הצפי לסוף החודש">
            <Amount agorot={total} size="display" currency={base} />
          </p>
          <p className="ui-forecast-today">היום <bdi dir="ltr">{forecastBigText(net, base)}</bdi></p>
          <ForecastSection
            title="צפוי להיכנס"
            total={<Amount agorot={build.incomeTotal} size="list" currency={base} direction="income" income />}
            items={income}
            onOpen={setOpen}
            leavingKey={leavingKey}
          />
          <section className="ui-forecast-section">
            <h2 className="ui-forecast-section-head">
              <span>צפוי לצאת</span>
              <span className="ui-forecast-section-total ui-forecast-total-out"><Amount agorot={build.expenseTotal} size="list" currency={base} direction="expense" /></span>
            </h2>
            <ul className="ui-forecast-list">
              {expense.map((item) => (
                <ForecastRowButton key={item.key} item={item} onOpen={setOpen} leaving={leavingKey === item.key} />
              ))}
              {build.small.length > 0 ? (
                <li className="ui-forecast-li">
                  <button type="button" className="ui-forecast-row ui-forecast-small" aria-expanded={smallOpen} onClick={() => { setSmallOpen((value) => !value); }}>
                    <span className="ui-forecast-initial" aria-hidden="true">{`+${String(build.small.length)}`}</span>
                    <span className="ui-forecast-text">
                      <span className="ui-forecast-name">חיובים קבועים קטנים</span>
                      <span className="ui-forecast-meta">{build.small.length === 1 ? "חיוב אחד" : `${String(build.small.length)} חיובים`}</span>
                    </span>
                    <span className="ui-forecast-amount"><Amount agorot={smallTotal} size="list" currency={base} direction="expense" /></span>
                  </button>
                  {smallOpen ? (
                    <ul className="ui-forecast-small-list">
                      {build.small.map((item) => (
                        <ForecastRowButton key={item.key} item={item} onOpen={setOpen} leaving={false} />
                      ))}
                    </ul>
                  ) : null}
                </li>
              ) : null}
            </ul>
          </section>
          {income.length + expense.length + build.small.length === 0 && moved.length === 0 ? (
            <EmptyState title="הכל הגיע החודש" body="כל החיובים וההכנסות הצפויים לחודש נכנסו לחשבון." />
          ) : null}
          {moved.length > 0 ? (
            <section className="ui-forecast-section ui-forecast-moved">
              <h2 className="ui-forecast-section-head">
                <span>לא החודש</span>
              </h2>
              <ul className="ui-forecast-list">
                {moved.map((item) => (
                  <ForecastRowButton key={item.key} item={item} onOpen={setOpen} leaving={false} />
                ))}
              </ul>
            </section>
          ) : null}
          <div className={cx("ui-forecast-changed", changed > 0 && "ui-forecast-changed-on")} aria-hidden={changed === 0}>
            <span>{`שינית ${String(changed)} ${changed === 1 ? "פריט" : "פריטים"} בצפי`}</span>
            <button type="button" className="ui-forecast-reset" onClick={resetAll} disabled={changed === 0}>איפוס</button>
          </div>
          <p className="ui-forecast-foot t-hint">
            בצפי: הקבועים והתנועות הקבועות שעוד לא הגיעו החודש (הסכום הרגיל), חשבוניות לקוח פתוחות שטרם נגבו, חשבונות ספקים
            וחיובי הלוואה שעוד צפויים החודש. <Link to="/missing-bills">לקבועים</Link>
          </p>
        </>
      )}
      <ForecastItemSheet item={open} today={today} onOpenChange={(value) => { if (!value) setOpen(null); }} onSave={save} />
    </div>
  );
}
