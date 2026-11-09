import "../ui/lazy.css";
import { formatAmountText } from "@flow/shared";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useProjectsCashMonth } from "../project-cash";
import { usePreviewSearch, useHomePreview } from "../preview";
import { screenPhase } from "../query-phase";
import { useRecurringScheduleQuery, type ScheduleRow } from "../recurring-schedule";
import { useInvalidateBooks } from "../use-books";
import { useHoldWrites } from "../use-is-viewer";
import { BackButton } from "../ui/back";
import { PageLoadFailed, useOnline } from "../ui/band-states";
import { FocusTitle } from "../ui/focus-title";
import { GroupHead } from "../ui/group-head";
import { PlusIcon } from "../ui/icons";
import { SegmentedControl } from "../ui/segmented-control";
import { DelayedSkeleton, ListSkeleton } from "../ui/skeleton";
import { useToast } from "../ui/toast";
import { TopBand } from "../ui/top-band";
import { restoreUtilityPayer, setUtilityPayer, useUtilityPayersQuery, useUtilityRefundsQuery, useUtilityRpc, type Payer, type PayerPrior, type UtilityKey, type UtilityPayer } from "../utility-refunds";
import { AddSupplierSheet, supplierChoices } from "./project-utilities-add";
import { UTILITY_KEYS } from "./utility-refunds-actions";

const keyText = (row: { supplier_id: string; currency: string }) => `${row.supplier_id}:${row.currency}`;

/** "חשמל ומים · בדרך כלל $80", "נוסף ידנית" for a supplier with no bill yet, and "לא נבדק" while the company pays. */
function payerMeta(row: UtilityPayer, payer: Payer): string {
  const usual = row.usual_minor == null ? (row.added ? "נוסף ידנית" : "אין עדיין חשבונות") : `בדרך כלל ${formatAmountText(row.usual_minor, row.currency, { detail: true })}`;
  return [row.category_name, usual, payer === "company" ? "לא נבדק" : null].filter((part): part is string => part != null).join(" · ");
}

/**
 * FLOW-1135 (V3-Project-Utilities; decision 0265): the property's חשבונות, who pays each. Every utility with its usual
 * amount (the median of its last 3 bills) and a שוכר / חברה radiogroup: שוכר checks that the tenant paid each bill
 * back, חברה checks none and closes its open bills. הוספת ספק adds one of the property's recurring expenses. Every
 * change toasts with ביטול (set_utility_payer back to what it was). A viewer sees who pays and changes nothing.
 */
export function ProjectUtilitiesScreen() {
  const { projectId = "" } = useParams();
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const online = useOnline();
  const toast = useToast();
  const invalidate = useInvalidateBooks();
  const readOnly = useHoldWrites();
  const rpc = useUtilityRpc();
  const payers = useUtilityPayersQuery(projectId);
  const refunds = useUtilityRefundsQuery(projectId);
  const schedule = useRecurringScheduleQuery(preview === "off" && !readOnly);
  const row = useProjectsCashMonth(undefined, projectId).data?.projects.find((item) => item.id === projectId);
  const [picked, setPicked] = useState<ReadonlyMap<string, Payer>>(new Map());
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<readonly UtilityPayer[]>([]);

  const bills = refunds.data?.bills ?? [];
  const name = row?.name ?? bills.find((bill) => bill.project_id === projectId)?.project_name ?? "הנכס";
  const utilities = [...(payers.data ?? []), ...added]
    .filter((item, index, all) => all.findIndex((other) => keyText(other) === keyText(item)) === index);
  const openOf = (row: { supplier_id: string; currency: string }) =>
    bills.filter((bill) => bill.state === "not_refunded" && bill.project_id === projectId && keyText(bill) === keyText(row)).length;
  const payerOf = (item: UtilityPayer): Payer => picked.get(keyText(item)) ?? item.payer;
  const open = utilities.filter((item) => payerOf(item) === "tenant").reduce((sum, item) => sum + openOf(item), 0);
  const phase = screenPhase(preview, payers);
  // The head's "הכול הוחזר" is a claim: it waits for the bills, and says so when they did not load.
  const refundsPhase = screenPhase(preview, refunds);
  const back = `/projects/${projectId}${search}`;

  const pick = (key: string, payer: Payer | null) => {
    setPicked((before) => {
      const next = new Map(before);
      if (payer == null) next.delete(key);
      else next.set(key, payer);
      return next;
    });
  };

  /** Writes a payer; returns what was set before, or undefined after a failure (which the toast names). */
  async function write(run: () => Promise<PayerPrior>, failure: string): Promise<PayerPrior | undefined> {
    try {
      const prior = await run();
      void invalidate([...UTILITY_KEYS]);
      return prior;
    } catch {
      toast.show({ tone: "bad", message: failure });
      return undefined;
    }
  }

  async function change(item: UtilityPayer, payer: Payer) {
    const key: UtilityKey = { projectId, supplierId: item.supplier_id, currency: item.currency };
    const before = payerOf(item);
    if (before === payer) return;
    pick(keyText(item), payer);
    const prior = await write(() => setUtilityPayer(rpc(), key, payer, item.added), "השינוי של מי משלם לא נשמר. אפשר לנסות שוב.");
    if (prior === undefined) {
      pick(keyText(item), null);
      return;
    }
    const closed = openOf(item);
    toast.show({
      message: payer === "company" ? `${item.supplier_name} · החברה משלמת${closed > 0 ? ` · ${String(closed)} נסגרו` : ""}` : `${item.supplier_name} · השוכר מחזיר`,
      action: "ביטול",
      onAction: () => {
        void (async () => {
          if ((await write(() => restoreUtilityPayer(rpc(), key, prior), "הביטול לא נשמר. אפשר לנסות שוב.")) !== undefined) pick(keyText(item), before);
        })();
      },
    });
  }

  async function add(choice: ScheduleRow) {
    setAdding(false);
    const key: UtilityKey = { projectId, supplierId: choice.party_id, currency: choice.currency };
    const item: UtilityPayer = {
      supplier_id: choice.party_id, supplier_name: choice.party_name, currency: choice.currency, payer: "tenant",
      added: true, found: false, usual_minor: null, bill_count: 0, last_bill_date: null,
      category_id: choice.category_id, category_name: choice.category_name,
    };
    setAdded((before) => [...before, item]);
    const prior = await write(() => setUtilityPayer(rpc(), key, "tenant", true), "הספק לא נוסף. אפשר לנסות שוב.");
    const drop = () => { setAdded((before) => before.filter((other) => keyText(other) !== keyText(item))); };
    if (prior === undefined) {
      drop();
      return;
    }
    toast.show({
      message: `${choice.party_name} · נוסף`,
      action: "ביטול",
      onAction: () => {
        void (async () => {
          if ((await write(() => restoreUtilityPayer(rpc(), key, prior), "הביטול לא נשמר. אפשר לנסות שוב.")) !== undefined) drop();
        })();
      },
    });
  }

  const choices = supplierChoices(schedule.data ?? [], projectId, utilities);
  return (
    <div>
      <TopBand
        wordmark={false}
        leading={<BackButton fallback={back} text={name} onBand />}
        hero={(
          <>
            <FocusTitle className="t-name">חשבונות · מי משלם</FocusTitle>
            <p className="ui-band-label t-caption">{name}</p>
          </>
        )}
      />
      {phase.kind === "loading" ? (
        <DelayedSkeleton>
          <ListSkeleton />
        </DelayedSkeleton>
      ) : phase.kind === "error" ? (
        <div className="ui-page-pad">
          <PageLoadFailed title="החשבונות לא נטענו" offline={!online || phase.offline} onRetry={() => void payers.refetch()} />
        </div>
      ) : (
        <section className="ui-page-pad ui-utl-page" aria-labelledby="utl-head">
          <GroupHead
            id="utl-head"
            title="חשבונות"
            summary={refundsPhase.kind === "error"
              ? <button type="button" className="ui-utl-open" onClick={() => void refunds.refetch()}>לא נטען · ניסיון חוזר</button>
              : refundsPhase.kind !== "ready"
                ? <span className="ui-utl-wait">בודקים…</span>
                : open > 0
                  ? <Link className="ui-utl-open" to={`/utility-refunds?project=${encodeURIComponent(projectId)}${search === "" ? "" : `&${search.slice(1)}`}`}>{`${String(open)} לא הוחזרו`}</Link>
                  : "הכול הוחזר"}
          />
          <p className="ui-utl-lead">מי משלם כל חשבון. שוכר: בודקים שהחזיר. חברה: לא בודקים.</p>
          {utilities.length === 0 ? (
            <p className="ui-utl-lead">עוד לא נמצאו חשבונות בנכס. Flow מוצא אותם מהשורות בקטגוריות החשבונות.</p>
          ) : (
            <ul className="ui-utl-list" aria-label="חשבונות">
              {utilities.map((item) => {
                const payer = payerOf(item);
                return (
                  <li key={keyText(item)} className="ui-utl-row m-page-enter">
                    <span className="ui-utl-text">
                      <span className="ui-utl-name" data-clip-ok="">{item.supplier_name}</span>
                      <span className="ui-utl-meta">{payerMeta(item, payer)}</span>
                    </span>
                    <div className="ui-utl-payer">
                      <SegmentedControl<Payer>
                        label={`מי משלם: ${item.supplier_name}`}
                        showLabel={false}
                        value={payer}
                        disabled={readOnly}
                        options={[{ value: "tenant", label: "שוכר" }, { value: "company", label: "חברה" }]}
                        onChange={(next) => { void change(item, next); }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {readOnly ? null : (
            <button type="button" className="ui-utl-add m-press" onClick={() => { setAdding(true); }}>
              <PlusIcon size={20} stroke={2.2} />
              הוספת ספק
            </button>
          )}
          <p className="ui-utl-lead">Flow מוצא את הספקים מהשורות: קטגוריות החשבונות ושם הכרטיס. כל ספק מתחיל כ״שוכר״. מעבר ל״חברה״ סוגר את החשבונות הפתוחים שלו, עם ביטול.</p>
        </section>
      )}
      {readOnly ? null : (
        <AddSupplierSheet open={adding} onOpenChange={setAdding} choices={choices} onAdd={(choice) => { void add(choice); }} />
      )}
    </div>
  );
}
