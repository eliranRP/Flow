import type { MissingBill, PaymentRecurring, PartyCharges, RecurringChange, RecurringPace } from "@flow/shared";
import { formatAmountText } from "@flow/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { RECURRING_KEYS, runPaceChange, type PaceWrite } from "../pace-write";
import { useHomePreview, usePreviewSearch } from "../preview";
import { dismissRecurringAlert, answerRecurringMatch, liveRpcClient, restoreRecurringAlert, type AlertKind } from "../recurring-actions";
import { type ChargePageData, useChargePageData } from "../recurring-charge-data";
import { amountOf, bannerText, changeLine, chargeAlert, dayMonth, ignoredText, metaOf, monthsThrough, statusOf } from "../recurring-charge";
import { israelToday, type ScheduleRow } from "../recurring-schedule";
import { Button } from "../ui/button";
import { ChoiceSheet } from "../ui/choice-sheet";
import { EmptyState } from "../ui/empty-state";
import { ErrorState } from "../ui/error-state";
import { DelayedSkeleton, ListSkeleton } from "../ui/skeleton";
import { paceSheetCopy, paceToast, type PaceChoice } from "../ui/pace";
import { PartyChargesHistory, PartyChargesSheet } from "../ui/related-charges";
import { ChargeBanner, ChargeCard, ChargeHead, ChargeIgnored, RecurringRow } from "../ui/recurring-charge-parts";
import { RecurringMatchBox } from "../ui/recurring-match-box";
import { useToast } from "../ui/toast";
import { useWrite } from "../use-write";
import { TransactionTopBar } from "./transaction-top-bar";
import { useBlockedPreview } from "./screen-shared";

/** A dev fixture's party: the schedule row and the reads the page would make, as the server returns them. */
export type ChargeSample = {
  row: ScheduleRow;
  bills?: MissingBill[];
  changes?: RecurringChange[];
  lineId: string | null;
  charges: PartyCharges | null;
  recurring: PaymentRecurring | null;
};

/** What a pace pick changes here: the choice, and the state before it. The undo writes it back. */
type PaceChange = PaceWrite & { undo: boolean; close?: () => void };

/**
 * FLOW-447c: the charge page (קבועים › one party), opened from a row of the list. Its own writes are
 * the list's (ignore, restore) and the match answer, plus the pace sheet; a dev sample keeps them local.
 */
export function RecurringChargeScreen({ sample, openSheet, now = new Date() }: { sample?: ChargeSample; openSheet?: "pace" | "all"; now?: Date } = {}) {
  const params = useParams();
  const direction = sample == null ? params.direction : sample.row.direction;
  const partyId = sample == null ? params.partyId : sample.row.party_id;
  const valid = direction === "income" || direction === "expense";
  const live = useChargePageData(valid ? direction : "expense", partyId ?? "", sample == null && valid);
  const preview = useHomePreview();
  const today = israelToday(now);
  if (sample == null && !valid) return <ChargeMissing />;
  const data: ChargePageData = sample == null ? live : { status: "ready", ...sample, bills: sample.bills, changes: sample.changes };
  if (data.status === "loading") {
    return (
      <div className="ui-charge-page">
        <DelayedSkeleton>
          <ListSkeleton />
        </DelayedSkeleton>
      </div>
    );
  }
  if (data.status === "error") return <ChargeError />;
  if (data.status === "missing" || preview !== "off") return <ChargeMissing />;
  return <ChargeBody key={`${data.row.direction}:${data.row.party_id}`} data={data} live={sample == null} today={today} openSheet={openSheet} />;
}

/** The schedule did not load: one line and the retry. */
export function ChargeError() {
  const client = useQueryClient();
  return (
    <div className="ui-charge-page">
      <TransactionTopBar fallback="/recurring" backLabel="קבועים" title="קבועים" end={null} />
      <div className="ui-charge-body">
        <ErrorState offline={!navigator.onLine} onRetry={() => void client.invalidateQueries({ queryKey: ["recurring-schedule"] })} />
      </div>
    </div>
  );
}

/** The party is not a recurring row (it was marked not recurring, or the id is wrong). */
export function ChargeMissing() {
  const search = usePreviewSearch();
  return (
    <div className="ui-charge-page">
      <TransactionTopBar fallback="/recurring" backLabel="קבועים" title="קבועים" end={null} />
      <div className="ui-charge-body">
        <EmptyState title="החיוב לא נמצא" body="אולי סימנתם אותו כלא קבוע, או שהקישור ישן." action={<Button full to={`/recurring${search}`}>לקבועים</Button>} />
      </div>
    </div>
  );
}

function ChargeBody({
  data,
  live,
  today,
  openSheet,
}: {
  data: Extract<ChargePageData, { status: "ready" }>;
  live: boolean;
  today: string;
  openSheet?: "pace" | "all";
}) {
  const { row, lineId, charges, recurring } = data;
  const search = usePreviewSearch();
  const toast = useToast();
  const client = useQueryClient();
  const navigate = useNavigate();
  const blocked = useBlockedPreview();
  const income = row.direction === "income";
  const currency = row.currency;
  const thisMonth = today.slice(0, 7);
  // Local answers: an ignore, a match answer and a pace change show at once; a failure takes them back.
  const [ignoredLocal, setIgnoredLocal] = useState<boolean | null>(null);
  const [matchLocal, setMatchLocal] = useState<"same" | "never" | null>(null);
  const [paceLocal, setPaceLocal] = useState<{ recurring: boolean; pace: RecurringPace } | null>(null);
  const [paceOpen, setPaceOpen] = useState(openSheet === "pace");
  const [allOpen, setAllOpen] = useState(openSheet === "all");
  const [saving, setSaving] = useState<PaceChoice | null>(null);
  const paceRow = useRef<HTMLButtonElement>(null);
  const allRef = useRef<HTMLButtonElement>(null);
  // A not-recurring pick leaves the page once its sheet has closed: a navigate during the close would
  // sit under the sheet's own history entry, and Back would return to the page.
  const leaving = useRef(false);
  useEffect(() => {
    if (!paceOpen && leaving.current) {
      leaving.current = false;
      void navigate("/recurring");
    }
  }, [paceOpen, navigate]);

  const arrivedOn = row.state === "arrived" ? charges?.charges[0]?.doc_date ?? null : null;
  const status = statusOf(row, arrivedOn);
  const amount = amountOf(row);
  const alert = chargeAlert(row, data.bills, data.changes, lineId);
  const ignored = alert != null && (ignoredLocal ?? !alert.active);
  const suggestion = alert?.kind === "missing" && !ignored ? alert.suggestion : null;
  const showMatch = suggestion != null && matchLocal == null;
  const isRecurring = paceLocal?.recurring ?? true;
  const pace: RecurringPace = paceLocal?.pace ?? row.pace;
  const overridden = recurring?.override != null;
  const choice: PaceChoice = isRecurring ? pace : "never";
  const money = (minor: bigint) => formatAmountText(minor, currency);
  const project = row.project_name ?? (row.category_name == null ? "ללא פרויקט" : `ללא פרויקט · ${row.category_name}`);
  const category = row.category_name ?? "ללא קטגוריה";

  const refresh = () => {
    for (const key of RECURRING_KEYS) void client.invalidateQueries({ queryKey: [key] });
  };

  async function ignore() {
    if (alert?.key == null) return;
    const { key, kind } = alert;
    setIgnoredLocal(true);
    try {
      if (live) await dismissRecurringAlert(liveRpcClient(), key, kind);
    } catch {
      setIgnoredLocal(null);
      toast.show({ message: "לא הצלחנו לעדכן את השורה." });
      return;
    }
    if (live) refresh();
    toast.show({ message: "התעלמת מההתראה", action: "ביטול", onAction: () => void restore(key, kind) });
  }

  async function restore(key: string, kind: AlertKind) {
    setIgnoredLocal(false);
    try {
      if (live) await restoreRecurringAlert(liveRpcClient(), key, kind);
    } catch {
      setIgnoredLocal(true);
      toast.show({ message: "לא הצלחנו לעדכן את השורה." });
      return;
    }
    if (live) refresh();
    toast.show({ message: "ההתראה חזרה" });
  }

  async function answer(same: boolean | null) {
    if (suggestion == null) return;
    setMatchLocal(same === true ? "same" : same === false ? "never" : null);
    try {
      if (live) await answerRecurringMatch(liveRpcClient(), { direction: row.direction, partyId: row.party_id, matchPartyId: suggestion.party_id, same });
    } catch {
      setMatchLocal(null);
      toast.show({ message: "לא הצלחנו לעדכן את השורה." });
      return;
    }
    if (live) refresh();
    if (same === null) return;
    const message = same ? (income ? "סומן כאותו לקוח" : "סומן כאותו ספק") : "לא נציע שוב";
    toast.show({ message, action: "ביטול", onAction: () => void answer(null) });
  }

  const write = useWrite<PaceChange>({
    failure: (error) => (error.message.includes("forbidden") ? "אין הרשאה לעדכן את השורה." : "לא הצלחנו לעדכן את השורה."),
    keys: RECURRING_KEYS,
    onSuccess: (done) => {
      setSaving(null);
      if (done.next === "never" && !done.undo) leaving.current = true;
      done.close?.();
      if (done.undo) return;
      const message = done.next === "never" ? "סומן כלא קבוע" : paceToast(done.next);
      toast.show({ message, action: "ביטול", onAction: () => {
        undoPace(done);
      } });
    },
    onError: () => {
      setSaving(null);
    },
    run: async (change) => {
      if (!live) {
        setPaceLocal(change.next === "never" ? { recurring: false, pace: change.before.pace } : { recurring: true, pace: change.next });
        return;
      }
      await runPaceChange(liveRpcClient(), change);
    },
  });

  function undoPace(done: PaceChange) {
    write.mutate({
      id: done.id,
      next: done.before.recurring ? done.before.pace : "never",
      before: { recurring: done.next !== "never", pace },
      undo: true,
    });
  }

  const subLine = `${pace === "month" ? `בערך ב־${String(row.typical_day)} לחודש · ` : ""}${overridden ? "סימנת" : "זוהה לבד"}`;
  const alertText = alert == null ? null : ignored ? ignoredText(alert.kind) : bannerText(row, alert, today);

  return (
    <div className="ui-charge-page">
      <TransactionTopBar fallback="/recurring" backLabel="קבועים" title={row.party_name} end={null} />
      <div className="ui-charge-body">
        <ChargeHead
          status={status.text}
          statusBad={status.tone === "bad"}
          name={row.party_name}
          amount={`${income && row.state === "arrived" ? "+" : ""}${money(amount.minor)}`}
          muted={amount.muted}
          income={income && row.state === "arrived"}
          meta={metaOf(row, arrivedOn)}
        />
        {alert != null && alertText != null && !ignored ? (
          <ChargeBanner text={alertText} onIgnore={() => void ignore()} disabled={alert.key == null} />
        ) : null}
        {alert != null && ignored && alertText != null ? (
          <ChargeIgnored text={alertText} onRestore={() => void restore(alert.key ?? "", alert.kind)} disabled={alert.key == null} />
        ) : null}
        {showMatch ? (
          <RecurringMatchBox
            name={suggestion.party_name ?? ""}
            amount={money(suggestion.amount_minor)}
            date={dayMonth(suggestion.doc_date)}
            income={income}
            onYes={() => void answer(true)}
            onNo={() => void answer(false)}
          />
        ) : null}
        <ChargeCard project={project} category={category} />
        <section className="ui-card ui-charge-recurring">
          <RecurringRow
            title={income ? "הכנסה קבועה" : "תשלום קבוע"}
            sub={subLine}
            pace={pace}
            disabled={lineId == null && live}
            onOpen={() => {
              if (write.isPending || (live && blocked())) return;
              setPaceOpen(true);
            }}
          />
          {charges != null ? (
            <PartyChargesHistory
              plain
              data={charges}
              search={search}
              change={changeLine(row, currency, alert != null && !ignored)}
              months={monthsThrough(charges.months, thisMonth)}
              showAllRef={allRef}
              onShowAll={() => {
                setAllOpen(true);
              }}
            />
          ) : null}
        </section>
      </div>
      {charges != null ? (
        <PartyChargesSheet
          open={allOpen}
          onOpenChange={setAllOpen}
          data={charges}
          search={search}
          context={`${project} · ${category}`}
          returnFocusRef={allRef}
        />
      ) : null}
      <ChoiceSheet
        copy={paceSheetCopy(recurring?.detected_pace ?? null, row.party_name)}
        open={paceOpen}
        onOpenChange={setPaceOpen}
        value={choice}
        saving={saving}
        returnFocusRef={paceRow}
        panelClassName="ui-pace-sheet"
        onPick={(next, close) => {
          if (write.isPending || (live && blocked())) return;
          if (next === choice) {
            close();
            return;
          }
          setSaving(next);
          write.mutate({ id: lineId ?? "", next, before: { recurring: isRecurring, pace }, undo: false, close });
        }}
      />
    </div>
  );
}
