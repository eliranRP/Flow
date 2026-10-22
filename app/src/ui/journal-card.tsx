import { formatAmountText } from "@flow/shared";
import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { HintParts } from "./hint-parts";
import { AlertIcon, CheckIcon, ChevronDownIcon, ChevronIcon, EyeOffIcon, JournalIcon } from "./icons";
import "./css/55-journal.css";

/** One leg as the card draws it: a magnitude on its side, with its account's words. */
export type JournalRow = {
  key: string;
  /** The account: a category, a system account in Hebrew, or the bank account. */
  name: string;
  /** הכנסה, הוצאה, נכס, התחייבות or בנק. */
  type: string;
  project: string | null;
  /** Positive, on its side. */
  amount: bigint;
  /** Neither the bank nor in profit: faded, with the eye-off mark. */
  keptOut: boolean;
};

const KEPT_OUT = "לא נספר ברווח";

function money(minor: bigint, currency: string): string {
  return formatAmountText(minor, currency, { detail: true });
}

/** An account name: a bank account's last 4 never cut, the rest of the name takes the ellipsis. */
export function AccountName({ name }: { name: string }) {
  const match = /^(.*?)\s*(••\d{4})$/u.exec(name);
  return (
    <span className="ui-journal-name" dir="auto" data-clip-ok="">
      <span className="ui-journal-name-cut" data-clip-ok="">{match ? match[1] : name}</span>
      {match ? <span className="ui-journal-name-last4">{match[2]}</span> : null}
    </span>
  );
}

function Side({ title, rows, currency }: { title: "חובה" | "זכות"; rows: readonly JournalRow[]; currency: string }) {
  if (rows.length === 0) return null;
  return (
    <div className="ui-journal-side">
      <p className="ui-journal-side-title">{title}</p>
      <ul className="ui-journal-rows">
        {rows.map((row) => (
          <li key={row.key} className="ui-journal-row" data-kept-out={row.keptOut ? "" : undefined}>
            <span className="ui-journal-text">
              <AccountName name={row.name} />
              <span className="ui-journal-meta">
                {/* Whole parts wrap and no "·" starts or ends a line (HintParts); the kept-out mark stays one piece. */}
                <HintParts
                  parts={[
                    row.type,
                    ...(row.project != null ? [row.project] : []),
                    ...(row.keptOut ? [<span key="kept" className="ui-journal-kept"><EyeOffIcon size={14} />{KEPT_OUT}</span>] : []),
                  ]}
                />
              </span>
            </span>
            <bdi className="ui-num ui-journal-amount" dir="ltr">{money(row.amount, currency)}</bdi>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * FLOW-954 (board LedgerLinePlain and LedgerLineAdvanced). A line's journal entry, פקודת יומן: the
 * debits (חובה) then the credits (זכות), each leg with its account, type and project, a leg kept
 * out of profit faded with the eye-off mark, and a footer that says the entry balances. Read only.
 * `collapsible` draws the quiet "פקודת יומן ▾" link that opens it in place (a plain line); without
 * it the card shows open, with its book icon in the head (a line with legs outside the P&L).
 * `bookedByAi` adds "✦ נרשם ע״י Jev" when an MCP write booked the line.
 * FLOW-955: `editTo` draws "עריכה ›" at the footer's end, to the composer (an owner or editor only).
 * `proposed` is the review card's compact entry (board LedgerReviewCard): "הפקודה שהוצעה" with עריכה in
 * its head, on the raised tone, 48px rows.
 */
export function JournalCard({
  debit,
  credit,
  currency,
  balanced,
  bookedByAi = false,
  collapsible = false,
  initialOpen = false,
  editTo,
  proposed = false,
}: {
  debit: readonly JournalRow[];
  credit: readonly JournalRow[];
  currency: string;
  balanced: boolean;
  bookedByAi?: boolean;
  collapsible?: boolean;
  initialOpen?: boolean;
  editTo?: string;
  proposed?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const sectionId = useId();
  const debitTotal = debit.reduce((sum, row) => sum + row.amount, 0n);
  const creditTotal = credit.reduce((sum, row) => sum + row.amount, 0n);
  const edit = editTo != null ? (
    <Link className="ui-journal-edit" to={editTo}>
      עריכה
      {proposed ? null : <ChevronIcon size={16} />}
    </Link>
  ) : null;
  const card = (
    <section id={sectionId} className={collapsible ? "ui-journal m-page-enter" : "ui-journal"} aria-label={proposed ? "הפקודה שהוצעה" : "פקודת יומן"} data-proposed={proposed ? "" : undefined}>
      <div className="ui-journal-head">
        {collapsible || proposed ? null : <span className="ui-journal-icon"><JournalIcon size={22} /></span>}
        <span className="ui-journal-heading">
          <span className="ui-journal-title">{proposed ? "הפקודה שהוצעה" : "פקודת יומן"}</span>
          {proposed ? null : <span className="ui-journal-sub">כל החשבונות שהתנועה נוגעת בהם</span>}
        </span>
        {proposed ? edit : null}
        {bookedByAi ? (
          <span className="ui-journal-badge">
            <span aria-hidden="true">✦</span>
            {" נרשם ע״י Jev"}
          </span>
        ) : null}
      </div>
      <Side title="חובה" rows={debit} currency={currency} />
      <Side title="זכות" rows={credit} currency={currency} />
      <p className="ui-journal-foot">
        {balanced ? <CheckIcon size={18} /> : <AlertIcon size={18} />}
        {balanced ? (
          <span>
            {"מאוזן "}
            <span className="ui-journal-foot-note">
              {"· "}
              <bdi className="ui-num" dir="ltr">{money(debitTotal, currency)}</bdi>
              {" בחובה ובזכות"}
            </span>
          </span>
        ) : (
          <span>
            {"לא מאוזן "}
            <span className="ui-journal-foot-note">
              {"· "}
              <bdi className="ui-num" dir="ltr">{money(debitTotal, currency)}</bdi>
              {" בחובה, "}
              <bdi className="ui-num" dir="ltr">{money(creditTotal, currency)}</bdi>
              {" בזכות"}
            </span>
          </span>
        )}
        {proposed ? null : edit}
      </p>
    </section>
  );
  if (!collapsible) return card;
  return (
    <>
      <button
        type="button"
        className="ui-journal-toggle"
        aria-expanded={open}
        aria-controls={open ? sectionId : undefined}
        onClick={() => { setOpen((value) => !value); }}
      >
        <JournalIcon size={18} />
        פקודת יומן
        <span className="ui-journal-chevron" data-open={open ? "" : undefined}><ChevronDownIcon size={16} /></span>
      </button>
      {open ? card : null}
    </>
  );
}
