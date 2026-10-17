import { formatAmountText } from "@flow/shared";
import { useNavigate, useParams } from "react-router-dom";
import { absAgorot } from "../agorot";
import { usePreviewSearch } from "../preview";
import { Amount } from "../ui/amount";
import { Button } from "../ui/button";
import { CheckIcon, ChevronIcon } from "../ui/icons";
import { EmptyState } from "../ui/empty-state";
import { ScreenState } from "../ui/screen-state";
import { israelToday } from "../ui/date-math";
import { unpaidDaysOpen, unpaidDocumentUrl, unpaidIsMarked, UNPAID_OVERDUE_DAYS, type UnpaidInvoice, type UnpaidSummary } from "../unpaid";
import { UNPAID_MARKED, useUnpaidActions } from "./unpaid-actions";

/** dd/mm/yyyy, the invoice's date in full (the list uses dd/mm). */
function unpaidFullDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** Whole days from one ISO date to another. */
function daysBetween(from: string, to: string): number {
  return unpaidDaysOpen(from, to) * (to < from ? -1 : 1);
}

/**
 * The invoice page (FLOW-367), pushed from the list: its status, customer and amount, the bank deposit
 * it matches (with "זה התשלום" and "לא זה"), the facts, the SUMIT document, and the mark when nothing matches.
 */
export function InvoiceScreen({ sample, summary, invoiceId: invoiceIdProp }: { sample?: UnpaidInvoice[]; summary?: UnpaidSummary; invoiceId?: string } = {}) {
  const params = useParams();
  const invoiceId = invoiceIdProp ?? params.invoiceId ?? "";
  const search = usePreviewSearch();
  const navigate = useNavigate();
  const actions = useUnpaidActions(sample, summary);
  const { all, holdWrites, phase } = actions;
  const row = all.find((item) => item.id === invoiceId) ?? null;
  const today = israelToday();
  const marked = row != null && unpaidIsMarked(row);
  const match = row?.match ?? null;
  const days = row == null ? 0 : unpaidDaysOpen(row.doc_date, today);
  const over = days > UNPAID_OVERDUE_DAYS;
  const documentUrl = row == null ? null : unpaidDocumentUrl(row);
  const customer = row == null ? "" : row.customer_name ?? row.description;
  return (
    <ScreenState title="חשבונית" kicker="חשבוניות פתוחות" barOnly backTo={`/unpaid${search}`} phase={phase} onRetry={actions.retry}>
      {row == null && phase.kind === "ready" ? (
        <div className="ui-page-pad">
          <EmptyState title="החשבונית כבר לא פתוחה" body="היא סומנה או חוברה לתשלום, ולכן לא נשארה ברשימה." action={<Button full to={`/unpaid${search}`}>חשבוניות פתוחות</Button>} />
        </div>
      ) : row == null ? null : (
        <div className="ui-page-pad ui-inv-detail m-push-in">
          <div className="ui-inv-head">
            <p className="ui-inv-chip" data-over={over && !marked ? "true" : undefined} data-marked={marked ? "true" : undefined}>
              {marked ? UNPAID_MARKED : `פתוחה ${String(days)} ימים`}
            </p>
            <h2 className="ui-inv-customer">{customer}</h2>
            <Amount agorot={absAgorot(row.open_gross_agorot)} currency={row.currency ?? "ILS"} size="display" income signless />
            <p className="ui-inv-meta text-text-secondary">
              {[
                row.doc_number ? `חשבונית #${row.doc_number}` : "חשבונית",
                `הופקה ${unpaidFullDate(row.doc_date)}`,
                "SUMIT",
              ].join(" · ")}
            </p>
          </div>

          {match != null && !marked ? (
            <section className="ui-inv-match" aria-label="תשלום תואם בבנק">
              <p className="t-label ui-inv-match-title">✦ נמצא תשלום תואם בבנק</p>
              <div className="ui-inv-match-row">
                <span className="ui-inv-match-copy">
                  <span className="ui-inv-match-when">{`${unpaidFullDate(match.date)} · ${match.account_name}`}</span>
                  <span className="ui-inv-raw" dir="ltr">{match.raw_description}</span>
                </span>
                <span className="ui-inv-match-amount">
                  <bdi dir="ltr">{formatAmountText(match.amount_minor, row.currency ?? "ILS")}</bdi>
                </span>
              </div>
              <p className="ui-inv-explain t-hint text-text-secondary">
                {`אותו סכום ואותו לקוח, ${String(Math.max(0, daysBetween(row.doc_date, match.date)))} ימים אחרי החשבונית.`}
              </p>
              <div className="ui-inv-match-actions">
                <Button
                  className="ui-inv-match-yes"
                  disabled={holdWrites}
                  onClick={() => {
                    actions.linkMatch(row.id);
                    void navigate(`/unpaid${search}`);
                  }}
                >
                  זה התשלום
                </Button>
                <Button variant="secondary" className="ui-inv-match-no" disabled={holdWrites} onClick={() => { actions.dismissMatch(row.id); }}>
                  לא זה
                </Button>
              </div>
            </section>
          ) : null}

          <section className="ui-inv-facts" aria-label="פרטי החשבונית">
            <div className="ui-inv-fact">
              <span className="ui-inv-fact-label">פרויקט</span>
              <span className="ui-inv-fact-value">{row.project_name ?? "בלי פרויקט"}</span>
            </div>
            <div className="ui-inv-fact">
              <span className="ui-inv-fact-label">פתוחה</span>
              <span className="ui-inv-fact-value">
                {`${String(days)} ימים · מאז ${unpaidFullDate(row.doc_date)}`}
              </span>
            </div>
            <div className="ui-inv-fact">
              <span className="ui-inv-fact-label">בתזרים</span>
              <span className="ui-inv-fact-note text-text-secondary">לא נספרת עד שהתשלום מגיע. נכללת בצפי לסוף החודש.</span>
            </div>
          </section>

          {documentUrl != null ? (
            <a className="ui-inv-doc" href={documentUrl} target="_blank" rel="noopener noreferrer">
              <span className="ui-inv-thumb" aria-hidden="true"><span /><span /><span /></span>
              <span className="ui-inv-doc-copy">
                <span className="ui-inv-doc-title">{row.doc_number ? `חשבונית #${row.doc_number}` : "החשבונית"}</span>
                <span className="ui-inv-doc-sub">PDF מ־SUMIT · הקישו לפתיחה</span>
              </span>
              <span className="ui-inv-doc-chevron" aria-hidden="true"><ChevronIcon size={18} /></span>
            </a>
          ) : null}

          {!holdWrites && match == null && !marked ? (
            <div className="ui-inv-mark">
              <Button full className="ui-inv-mark-yes" onClick={() => { actions.setPaid(row.id, true); }} icon={<CheckIcon />}>סימון כשולם</Button>
              <p className="ui-inv-mark-note">שולם במזומן או בצ׳ק? סמנו כאן. העברה בנקאית תחובר לבד כשתגיע.</p>
            </div>
          ) : null}
          {!holdWrites && marked ? (
            <div className="ui-inv-mark">
              <Button full variant="secondary" onClick={() => { actions.setPaid(row.id, false); }}>ביטול הסימון</Button>
            </div>
          ) : null}
        </div>
      )}
    </ScreenState>
  );
}
