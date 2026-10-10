import { useId, useLayoutEffect, useState } from "react";
import { methodLabel, sameParty, splitAccountLast4, type MethodIconKind, type MethodLabel, type TxnMeta } from "../txn-meta";
import { BankIcon, BuildingIcon, CardIcon, ChevronDownIcon, DocumentIcon, InfoIcon, NoteIcon, TransferIcon } from "./icons";
import { List, ListRow } from "./list-row";

/** The payment-method icon. Decorative: the label next to it carries the meaning. */
export function MethodIcon({ kind, size = 16 }: { kind: MethodIconKind; size?: number }) {
  return (
    <span className="ui-method-icon" aria-hidden="true">
      {kind === "card" ? <CardIcon size={size} /> : kind === "transfer" ? <TransferIcon size={size} /> : <DocumentIcon size={size} stroke={1.9} />}
    </span>
  );
}

/**
 * FLOW-304. "פרטי הבנק" on the transaction screen: static rows, one per field the
 * bank sent. Nothing is rendered when there is no row to show.
 */
export function BankDetails({
  meta,
  party,
  direction,
}: {
  meta: TxnMeta | null | undefined;
  /** The supplier or customer shown above. A counterparty equal to it is not repeated. */
  party: string | null | undefined;
  direction: "income" | "expense";
}) {
  const titleId = useId();
  if (meta == null) return null;
  const method = methodLabel(meta);
  const account = meta.account == null ? null : splitAccountLast4(meta.account);
  const counterparty = meta.counterparty != null && !sameParty(meta.counterparty, party) ? meta.counterparty : null;
  if (method == null && account == null && counterparty == null && meta.memo == null && meta.bank_description == null) return null;
  return (
    <section className="ui-bank" aria-labelledby={titleId}>
      <div className="ui-section-head">
        <h2 className="t-title-3" id={titleId}>פרטי הבנק</h2>
      </div>
      <List>
        {method ? (
          <ListRow
            variant="static"
            eyebrow="אמצעי תשלום"
            icon={<MethodIcon kind={method.icon} size={24} />}
            title={<MethodTitle method={method} cardName={meta.method === "card" ? meta.card_name ?? null : null} />}
          />
        ) : null}
        {account ? (
          <ListRow
            variant="static"
            eyebrow="חשבון"
            icon={<BankIcon />}
            title={
              <span className="ui-bank-account" dir="auto">
                {account.name ? <span className="ui-bank-account-name" data-clip-ok="">{account.name}</span> : null}
                {account.last4 ? <span className="ui-num ui-bank-last4">{`••${account.last4}`}</span> : null}
              </span>
            }
          />
        ) : null}
        {counterparty ? (
          <ListRow
            variant="static"
            eyebrow={direction === "income" ? "משלם" : "נמען"}
            icon={<BuildingIcon />}
            title={<bdi className="ui-bank-line" dir="auto" data-clip-ok="">{counterparty}</bdi>}
          />
        ) : null}
        {meta.memo ? <MemoRow memo={meta.memo} /> : null}
        {meta.bank_description ? (
          <ListRow
            variant="static"
            className="ui-bank-wrap"
            eyebrow="תיאור בבנק"
            icon={<InfoIcon size={24} />}
            title={<bdi className="ui-bank-text" dir="auto">{meta.bank_description}</bdi>}
          />
        ) : null}
      </List>
    </section>
  );
}

/**
 * "כרטיס ••1234", then the card's nickname from the bank (FLOW-707). The nickname is the part that
 * clips; the card and its last 4 never do.
 */
function MethodTitle({ method, cardName }: { method: MethodLabel; cardName: string | null }) {
  const card =
    method.detail === method.spoken ? (
      method.detail
    ) : (
      <>
        <span aria-hidden="true">
          {"כרטיס "}
          <span className="ui-num">{method.short}</span>
        </span>
        <span className="sr-only">{method.spoken}</span>
      </>
    );
  if (!cardName) return card;
  return (
    <span className="ui-bank-account">
      <span className="ui-bank-last4">{card}</span>
      <span className="ui-bank-sep" aria-hidden="true">·</span>
      <bdi className="ui-bank-account-name" dir="auto" data-clip-ok="">
        {cardName}
      </bdi>
    </span>
  );
}

/**
 * The memo wraps up to 4 lines. Past 4 lines the row is a button that shows the rest, with a ▾ cue
 * like the review card's memo (FLOW-315); the cue turns over while the memo is open.
 */
function MemoRow({ memo }: { memo: string }) {
  const [box, setBox] = useState<HTMLSpanElement | null>(null);
  const [clamped, setClamped] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    if (box == null || open) return;
    const measure = () => {
      setClamped(box.scrollHeight > box.clientHeight + 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => {
      observer.disconnect();
    };
  }, [box, open, memo]);
  const title = (
    <span ref={setBox} className="ui-bank-memo" dir="auto" data-open={open ? "" : undefined}>
      {memo}
    </span>
  );
  if (!clamped) {
    return <ListRow variant="static" className="ui-bank-wrap" eyebrow="הערה" icon={<NoteIcon />} title={title} />;
  }
  return (
    <ListRow
      variant="button"
      className="ui-bank-wrap"
      eyebrow="הערה"
      icon={<NoteIcon />}
      title={title}
      meta={(
        <span className="ui-bank-memo-cue" data-open={open ? "" : undefined} aria-hidden="true">
          <ChevronDownIcon size={16} />
        </span>
      )}
      expanded={open}
      onClick={() => {
        setOpen((value) => !value);
      }}
    />
  );
}
