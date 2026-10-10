import { useId, type ReactNode, type Ref } from "react";
import { Link } from "react-router-dom";
import { Avatar } from "./avatar";
import { BigNumber } from "./big-number";
import { StatusPill } from "./chip";
import { cx } from "./cx";
import { MatchText } from "./match-text";
import { statementRowLabel, textDir, type StatementDetail, type StatementMethod } from "./statement";
import { BankIcon, ChevronIcon, DocumentIcon, GripIcon } from "./icons";
import { Skeleton } from "./skeleton";

type Common = {
  title: ReactNode;
  /** Muted line above the title. Project and category rows use it. */
  eyebrow?: string;
  hint?: ReactNode;
  /** The hint wraps instead of ending in an ellipsis. */
  wrapHint?: boolean;
  /** The hint's whole parts on one line; a part that does not fit drops (a transaction row always does). */
  hintParts?: readonly ReactNode[];
  /** Hint uses t-hint, and the control points at it with aria-describedby. */
  describeHint?: boolean;
  href?: string;
  /** The href is an outside page: it opens in a new tab, and the name says so. */
  external?: boolean;
  state?: unknown;
  action?: ReactNode;
  /** The action sits under the row, on the start side under the name (FLOW-335). */
  actionBelow?: boolean;
  icon?: ReactNode;
  chevron?: boolean;
  /** FLOW-408: a row with no chevron keeps its space, so its amount lines up with linked rows above and below. */
  chevronSpace?: boolean;
  grip?: boolean;
  /** Hidden categories use a muted name. */
  muted?: boolean;
  meta?: ReactNode;
  /** Small tint after the title. The change sheet uses "הצעה". */
  tag?: ReactNode;
  /** Replaces the accessible name. Summary rows say "פרויקט: X, שינוי". */
  label?: string;
  /** An email or other Latin value. The title stays LTR so the start remains visible. */
  ltrTitle?: boolean;
  className?: string;
  /** Warning paints the hint and the icon. Muted paints the icon like the hint. */
  tone?: "warning" | "muted";
  /** A line kept out of profit fades, so it reads as set aside (owner's pick C, 2026-10-09); its hint stays at full muted grey (FLOW-352). */
  setAside?: boolean;
  /** The hint slot holds a skeleton bar, at the real hint line height. */
  skelHint?: boolean;
  /** The hint is a polite status, so a failure is announced. */
  hintStatus?: boolean;
  /** The title is a heading. Only a static row uses it. The expired assistant sheet does. */
  heading?: boolean;
};

export type ListRowProps =
  | (Common & {
    variant: "project";
    agorot: bigint;
    loss?: boolean;
    currency?: string;
    amounts?: { minor: bigint; currency: string }[];
    amountDirection?: "expense" | "income";
    /** A small mark before the amount. The project page's up mark (FLOW-401). */
    mark?: ReactNode;
    /** No amount yet: a muted "—" with this hidden word instead (FLOW-401: a bill not in yet). */
    missing?: string;
  })
  | (Common & {
    variant: "transaction";
    agorot: bigint;
    /** "cost": money out in a list already titled as a cost, so no minus (DESIGN-RULES §3.7, FLOW-339). */
    sign: "in" | "out" | "cost";
    source: "invoice" | "bank";
    currency?: string;
    /** Hidden word before money in. Default הכנסה; a refund line says זיכוי. */
    inWord?: string;
  })
  | StatementRowProps
  | (Common & { variant: "item"; plain?: boolean })
  | (Common & { variant: "static"; busy?: boolean })
  | (Common & { variant: "button"; onClick?: () => void; busy?: boolean; expanded?: boolean; disabled?: boolean; ariaDisabled?: boolean; buttonRef?: Ref<HTMLButtonElement>; clearHint?: boolean })
  | {
    variant: "skeleton";
    /** Holds the icon slot the loaded row has. */
    icon?: boolean;
    /** A short eyebrow over a long value, as an eyebrow row draws (FLOW-358). Default: long title over short hint. */
    eyebrow?: boolean;
    /** The end-side bar for an amount; false for a row with only a chevron or nothing at its end. */
    end?: boolean;
  }
  | (Common & { variant: "danger"; onClick: () => void; busy?: boolean; disabled?: boolean; /** A refused delete keeps its reason at full contrast (FLOW-405). */ clearHint?: boolean; buttonRef?: Ref<HTMLButtonElement> })
  | (Common & { variant: "selectable"; selected: boolean; onSelect: () => void });

/**
 * A bank-statement row (FLOW-305, option A): initials avatar, the counterparty, then a pending chip
 * and "✦ project · category"; the amount with small cents at the end and the method under it.
 * Same ui-row base, hit area, pressed tint and focus ring as the other link rows.
 */
export type StatementRowProps = {
  variant: "statement";
  /** The counterparty: supplier name, else the line's description. */
  title: string;
  /** The avatar's icon when the name has no letter. */
  fallback: "bank" | "invoice";
  /** Optional: drawn under the amount when passed. */
  method?: StatementMethod | null;
  /** "project · category", already joined. */
  suggestion?: string | null;
  /** The suggestion is Jev's fill: line 2 reads "✦ Jev · …" and the name says הצעת Jev (FLOW-704). */
  suggestionJev?: boolean;
  pending?: boolean;
  agorot: bigint;
  currency?: string;
  sign: "in" | "out";
  /** Hidden word before money in. Default הכנסה. */
  inWord?: string;
  href: string;
  state?: unknown;
  /** Replaces the built name (statementRowLabel). */
  label?: string;
  /** Typed search text: its first match in the name is tinted (FLOW-323). */
  match?: string;
  /** Muted facts on line 2 after the suggestion, joined with " · " (Search: statuses only, FLOW-339 option C). FLOW-323. */
  details?: StatementDetail[];
  /** A line kept out of profit: it fades but keeps line 2 at full muted grey (owner's pick C; FLOW-352). */
  setAside?: boolean;
};

export function ListRow(props: ListRowProps) {
  const hintId = useId();
  if (props.variant === "statement") return <StatementRow {...props} />;
  if (props.variant === "skeleton") {
    return (
      <div className="ui-row" aria-hidden="true">
        {props.icon === true ? (
          <span className="ui-row-icon">
            <Skeleton className="ui-skel-icon" />
          </span>
        ) : null}
        <span className="ui-skel-copy">
          <Skeleton width={props.eyebrow === true ? "sm" : "md"} />
          <Skeleton width={props.eyebrow === true ? "md" : "sm"} />
        </span>
        {props.end === false ? null : <Skeleton width="sm" />}
      </div>
    );
  }
  const described = props.describeHint === true && props.hint != null ? hintId : undefined;
  const softDisabled = props.variant === "button" && props.ariaDisabled === true;
  const rowDisabled = ((props.variant === "button" || props.variant === "danger") && props.disabled === true) || softDisabled;
  const busyRow = props.variant === "button" && props.busy === true;
  // A linked transaction row opens its card, so it carries the chevron unless the caller opts out (FLOW-328).
  const wantsChevron = props.chevron ?? (props.variant === "transaction" && props.href != null);
  const showChevron = wantsChevron && props.variant !== "static" && !rowDisabled && !busyRow;
  const toneClass = props.tone === "warning" ? "ui-row-tone-warning" : props.tone === "muted" ? "ui-row-tone-muted" : false;
  const baseIcon =
    props.icon ??
    (props.variant === "transaction" ? props.source === "bank" ? <BankIcon /> : <DocumentIcon size={24} /> : null);
  // A busy action row shows a spinner in place of its icon, so a tap visibly started.
  const icon = busyRow && baseIcon ? <span className="ui-spinner" aria-hidden="true" /> : baseIcon;
  const blockCopy = props.variant === "static";
  const CopyMain = blockCopy ? "div" : "span";
  const CopyText = blockCopy ? "div" : "span";
  // FLOW-125: a Latin-only title in an RTL row runs LTR, so a long one is cut at its end, not its start.
  // A title with any Hebrew keeps the row's direction.
  const autoLtr = !props.ltrTitle && typeof props.title === "string" && textDir(props.title) === "ltr" && !/[א-ת]/.test(props.title);
  const titleClass = cx(
    "ui-row-title",
    props.muted && "ui-row-title-muted",
    props.tag ? "ui-row-title-with-tag" : false,
    autoLtr && !props.tag && "ui-row-title-ltr",
  );
  const titleDir = props.ltrTitle || (autoLtr && !props.tag) ? "ltr" : undefined;
  // FLOW-322: a linked row with an action (the categories ⋯) keeps the action beside the link, not inside it.
  const sideAction = (props.variant === "item" || props.variant === "project" || props.variant === "transaction")
    && props.href != null && props.action != null && props.actionBelow !== true;
  // A transaction row's hint stays on one line and ends in an ellipsis, so a line never ends on a "·".
  const oneLineHint = props.hintParts != null || (props.variant === "transaction" && !props.wrapHint);
  const hintValue = props.hintParts ?? props.hint;
  const titleBody = (
    <>
      {props.tag ? (
        <span className={cx("ui-row-title-text", autoLtr && "ui-row-title-ltr")} dir={autoLtr ? "ltr" : undefined} data-clip-ok="">
          {titleText(props)}
        </span>
      ) : titleText(props)}
      {props.tag}
    </>
  );
  const body = (
    <>
      {props.grip ? (
        <span className="ui-grip" aria-hidden="true">
          <GripIcon />
        </span>
      ) : null}
      <CopyMain className="ui-row-main">
        {icon ? <span className="ui-row-icon">{icon}</span> : null}
        <CopyText className="ui-row-text">
          {props.eyebrow ? <span className="ui-row-hint">{props.eyebrow}</span> : null}
          {props.heading && blockCopy ? (
            <h3 className={titleClass} dir={titleDir}>{titleBody}</h3>
          ) : (
            <span className={titleClass} dir={titleDir}>{titleBody}</span>
          )}
          {hintValue != null ? (
            <span
              id={described}
              role={props.hintStatus ? "status" : undefined}
              className={cx(
                "ui-row-hint",
                props.describeHint === true && "t-hint",
                props.wrapHint && "ui-row-hint-wrap",
                props.skelHint && "ui-row-hint-skel",
                oneLineHint && "ui-row-hint-line",
              )}
              data-clip-ok={oneLineHint ? "" : undefined}
            >
              {oneLineHint ? hintParts(hintValue) : hintValue}
            </span>
          ) : null}
        </CopyText>
      </CopyMain>
      {props.variant === "project" ? props.mark : null}
      {props.variant === "project" || props.variant === "transaction" ? <RowAmount {...props} /> : null}
      {props.meta ? <span className="ui-row-meta t-hint">{props.meta}</span> : null}
      {props.actionBelow || sideAction ? null : props.action}
      {showChevron ? (
        <span className="ui-row-chevron" aria-hidden="true">
          <ChevronIcon />
        </span>
      ) : props.chevronSpace === true ? (
        <span className="ui-row-chevron ui-row-chevron-space" aria-hidden="true">
          <ChevronIcon />
        </span>
      ) : null}
      {props.external === true && props.href != null ? <span className="sr-only">{NEW_TAB}</span> : null}
    </>
  );

  if (props.variant === "static") {
    return (
      <div
        className={cx("ui-row", toneClass, props.className)}
        role={described ? "group" : undefined}
        aria-label={described ? rowName(props) : undefined}
        aria-describedby={described}
        aria-busy={props.busy === true || undefined}
      >
        {body}
      </div>
    );
  }
  if (props.variant === "button") {
    return (
      <button
        ref={props.buttonRef}
        type="button"
        className={cx("ui-row", "ui-hit", toneClass, props.clearHint === true && rowDisabled && "ui-row-clear-hint", props.className)}
        disabled={props.disabled === true}
        aria-disabled={softDisabled || undefined}
        aria-busy={props.busy === true}
        aria-expanded={props.expanded}
        aria-label={described ? rowName(props) : props.label}
        aria-describedby={described}
        onClick={() => {
          // A busy row stays focusable but ignores taps, so one run cannot start twice.
          if (props.disabled === true || props.ariaDisabled === true || props.busy === true) return;
          props.onClick?.();
        }}
      >
        {body}
      </button>
    );
  }
  if (props.variant === "danger") {
    return (
      <button
        ref={props.buttonRef}
        type="button"
        className={cx("ui-row ui-hit ui-row-danger", props.clearHint === true && props.disabled === true && "ui-row-clear-hint")}
        disabled={props.disabled === true || props.busy === true}
        aria-busy={props.busy === true}
        aria-label={described ? rowName(props) : undefined}
        aria-describedby={described}
        onClick={props.onClick}
      >
        {body}
      </button>
    );
  }
  if (props.variant === "selectable") {
    return (
      <button type="button" className="ui-row ui-hit" aria-pressed={props.selected} onClick={props.onSelect}>
        {body}
      </button>
    );
  }

  const className = cx(
    props.variant === "project"
      ? "ui-row ui-row-project ui-hit"
      : props.variant === "item" && props.plain === true
        ? "ui-row"
        : "ui-row ui-hit",
    toneClass,
    props.setAside === true && "ui-row-set-aside",
    props.className,
  );
  const row = props.href && props.external === true ? (
    <a
      href={props.href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      aria-label={externalName(described ? rowName(props) : props.label)}
      aria-describedby={described}
    >
      {body}
    </a>
  ) : props.href ? (
    <Link
      to={props.href}
      state={props.state}
      className={className}
      aria-label={described ? rowName(props) : props.label}
      aria-describedby={described}
    >
      {body}
    </Link>
  ) : (
    <div className={className} role={described ? "group" : undefined} aria-label={described ? rowName(props) : undefined} aria-describedby={described}>
      {body}
    </div>
  );
  if (sideAction) {
    return (
      <div className="ui-row-side">
        {row}
        {props.action}
      </div>
    );
  }
  return withAction(props, row);
}

const NEW_TAB = "(נפתח בלשונית חדשה)";

/** An outside link's own name keeps the new-tab note the hidden span gives the content. */
function externalName(name: string | undefined): string | undefined {
  return name == null ? undefined : `${name} ${NEW_TAB}`;
}

function rowName(props: { label?: string; title: ReactNode }): string | undefined {
  if (props.label) return props.label;
  return typeof props.title === "string" ? props.title : undefined;
}

const HINT_SEPARATOR = " · ";

/**
 * A one-line hint "מגדל הים · 03/10 · חלק משותף": whole parts, in order, as many as fit. A part
 * that does not fit drops to a hidden second line with its separator, so a line never ends on
 * "·" and a date is never cut. Only a first part that is too long on its own ends in an ellipsis.
 * Screen readers still read every part.
 */
function hintParts(hint: ReactNode | readonly ReactNode[]): ReactNode {
  const parts = isPartList(hint) ? hint : typeof hint === "string" && hint.includes(HINT_SEPARATOR) ? hint.split(HINT_SEPARATOR) : null;
  if (parts == null) return hint as ReactNode;
  return (
    <span className="ui-hint-parts">
      {parts.map((part, index) => (
        <span key={index} className="ui-hint-part" data-clip-ok="">
          {index > 0 ? HINT_SEPARATOR : null}
          {part}
        </span>
      ))}
    </span>
  );
}

function isPartList(hint: ReactNode | readonly ReactNode[]): hint is readonly ReactNode[] {
  return Array.isArray(hint);
}

function titleText(props: Common): ReactNode {
  if (!props.ltrTitle) return props.title;
  return <bdi dir="ltr">{props.title}</bdi>;
}

function withAction(props: { actionBelow?: boolean; action?: ReactNode }, row: ReactNode) {
  if (!props.actionBelow || props.action == null) return row;
  return (
    <div className="ui-row-stack ui-row-stack-action">
      {row}
      <div className="ui-row-action">{props.action}</div>
    </div>
  );
}

function SignedAmount(props: { agorot: bigint; currency?: string; sign: "in" | "out" | "cost"; inWord?: string }) {
  const abs = props.agorot < 0n ? -props.agorot : props.agorot;
  const cost = props.sign === "cost";
  // The amount's sign wins over the direction: a negative income (an income credit) shows its
  // minus in the main text colour and is never green (decision 0120).
  const income = props.sign === "in" && props.agorot >= 0n;
  // Income is green with no plus; the hidden word keeps direction out of colour alone (WCAG 1.4.1).
  return (
    <span className="t-amount">
      {income ? <span className="sr-only">{props.inWord ?? "הכנסה"} </span> : null}
      <BigNumber
        agorot={abs}
        currency={props.currency}
        direction={income ? "income" : cost ? undefined : "expense"}
        income={income}
        cents="always"
      />
    </span>
  );
}

function StatementRow(props: StatementRowProps) {
  const dir = textDir(props.title);
  const label = props.label ?? statementRowLabel(props);
  const details = (props.details ?? []).filter((detail) => detail.text !== "");
  const line2 = props.pending === true || (props.suggestion != null && props.suggestion !== "") || details.length > 0;
  return (
    <Link to={props.href} state={props.state} className={cx("ui-row ui-hit ui-row-statement", props.setAside === true && "ui-row-set-aside")} aria-label={label}>
      <span className="ui-row-main">
        <Avatar name={props.title} fallback={props.fallback} />
        <span className="ui-row-text">
          <span className="ui-row-title ui-statement-title" dir={dir}>
            <MatchText text={props.title} match={props.match} />
          </span>
          {line2 ? (
            <span className="ui-row-hint ui-statement-line">
              {props.pending === true ? <StatusPill>בהמתנה</StatusPill> : null}
              {props.suggestion ? (
                // FLOW-704: whole parts, as in the details below. "✦" always shows; on a Jev fill
                // "Jev" follows when it fits, then the values, which end in "…".
                <span className="ui-statement-suggest ui-hint-parts" data-clip-ok="">
                  <span className="ui-hint-part ui-statement-spark" aria-hidden="true">✦</span>
                  {props.suggestionJev === true ? (
                    <span className="ui-hint-part ui-statement-spark" aria-hidden="true"> Jev</span>
                  ) : null}
                  <span className="ui-hint-part ui-hint-part-keep">
                    {props.suggestionJev === true ? HINT_SEPARATOR : " "}
                    {props.suggestion}
                  </span>
                </span>
              ) : null}
              {details.length > 0 ? (
                // FLOW-339 C6-6: whole parts as many as fit, as on a transaction row's hint, so a
                // project or category never ends as one letter and "…". A state to act on
                // ("ממתינה לאישור") never drops: it shortens instead.
                <span className="ui-statement-details ui-hint-parts">
                  {details.map((detail, index) => (
                    <span
                      key={`${String(index)}:${detail.text}`}
                      className={detail.tone === "accent" || detail.keep === true ? "ui-hint-part ui-hint-part-keep" : "ui-hint-part"}
                      data-clip-ok=""
                    >
                      {index > 0 ? HINT_SEPARATOR : null}
                      <span className={detail.tone === "accent" ? "ui-statement-accent" : undefined}>{detail.text}</span>
                    </span>
                  ))}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
      </span>
      <span className="ui-statement-end">
        <SignedAmount agorot={props.agorot} currency={props.currency} sign={props.sign} inWord={props.inWord} />
        {props.method != null ? (
          <span className="ui-statement-method t-meta">
            <span className="ui-statement-method-icon" aria-hidden="true">{props.method.icon}</span>
            {props.method.ltr === true ? <bdi dir="ltr" className="ui-num">{props.method.text}</bdi> : <span>{props.method.text}</span>}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

function RowAmount(props: Extract<ListRowProps, { variant: "project" | "transaction" }>) {
  if (props.variant === "transaction") {
    return <SignedAmount agorot={props.agorot} currency={props.currency} sign={props.sign} inWord={props.inWord} />;
  }
  if (props.missing != null) {
    return (
      <span className="ui-row-missing t-amount">
        <span aria-hidden="true">—</span>
        <span className="sr-only">{props.missing}</span>
      </span>
    );
  }
  if (props.amounts != null && props.amounts.length > 0) {
    return (
      <span className="ui-row-amounts t-amount">
        {props.amounts.map((amount) => (
          <BigNumber
            key={amount.currency}
            agorot={amount.minor}
            currency={amount.currency}
            size="list"
            loss={amount.minor < 0n}
          />
        ))}
      </span>
    );
  }
  return (
    <BigNumber
      agorot={props.agorot}
      currency={props.currency}
      size="list"
      loss={props.loss === true}
      direction={props.amountDirection}
    />
  );
}

export function List({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("ui-project-list", className)}>{children}</div>;
}
