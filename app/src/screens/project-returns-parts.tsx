import { useId, type ReactNode, type Ref } from "react";
import { Link } from "react-router-dom";
import { lineInitials } from "../cash-lines-groups";
import { Amount } from "../ui/amount";
import { Button } from "../ui/button";
import { FailureLine } from "../ui/empty-state";
import { ChevronIcon } from "../ui/icons";
import { rowSource } from "../ui/line-marks";
import { GroupHead } from "../ui/group-head";
import { List, ListRow } from "../ui/list-row";
import { ProfitRowsSkeleton } from "../ui/screen-skeletons";
import { DelayedSkeleton } from "../ui/skeleton";
import { linesByMonth } from "./report-lines-screen";
import { usePropertyReturnLinesQuery, type ReturnLine, type ReturnLineRow, type ReturnLinesPage } from "./project-returns-data";
import { INFINITY, INFINITY_NAME, type EditField, type FigureValue, type Formula, type FormulaRow, type Op, type Target } from "./project-returns-info";

/* ------------------------------------------------------------------------------------------------
 * FLOW-451: the parts the returns pages and the ⓘ sheet share: a figure (or "חסר · הוספה"), a
 * formula's rows with their operators, and a figure's transactions by month.
 * ---------------------------------------------------------------------------------------------- */

/** Where the investment page lives: the project's, or a dev fixture's. */
export function investmentBase(projectId: string): string {
  return `/projects/${projectId}/investment`;
}

/** `search` with one more key, for an edit link (`?edit=land`). */
export function withParam(search: string, key: string, value: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.set(key, value);
  return `?${params.toString()}`;
}

/** What a row does: a link, or (on the investment page) a sheet. */
export type RowAction = { href: string } | { onClick: () => void };
export type Resolve = (target: Target) => RowAction | null;

/** The pages' links: an input opens its edit sheet on the investment page. */
export function pageResolver(base: string, search: string): Resolve {
  return (target) => {
    if (target.kind === "line") {
      return { href: `${base}/returns/${target.line}${target.categoryId == null ? search : withParam(search, "category", target.categoryId)}` };
    }
    if (target.kind === "statement") return { href: `${base}/returns${search}` };
    if (target.kind === "part") return { href: `${base}/part/${target.part}${search}` };
    if (target.kind === "loans") return { href: target.loanId == null ? `/loans${search}` : `/loans/${target.loanId}${search}` };
    return { href: `${base}${withParam(search, "edit", target.field)}` };
  };
}

/** ∞ in a per-cent figure's place, named for a screen reader (FLOW-457). */
export function InfinityFigure({ className }: { className: string }) {
  return <bdi dir="ltr" className={className} role="img" aria-label={INFINITY_NAME}>{INFINITY}</bdi>;
}

/** A figure as text. `addText` draws a plain הוספה (inside a row that is itself the button). */
export function FigureText({ value, currency, loss = false, addText = false }: { value: FigureValue; currency: string; loss?: boolean; addText?: boolean }) {
  if (value.kind === "money") return <Amount agorot={value.minor} currency={currency} income={value.income === true} loss={loss && value.minor < 0n} />;
  if (value.kind === "text") return value.text === INFINITY ? <InfinityFigure className="ui-num" /> : <bdi dir="ltr" className="ui-num">{value.text}</bdi>;
  if (value.kind === "note") return <span className="ui-ret-note">{value.text}</span>;
  return (
    <span className="ui-ret-missing">
      <span>{value.note ?? "חסר"}</span>
      {addText && value.add != null ? <span className="ui-ret-add">הוספה</span> : null}
    </span>
  );
}

const OP_WORDS: Record<Op, string> = { "": "", "+": "ועוד", "−": "פחות", "÷": "חלקי", "×": "כפול", "=": "שווה" };

function rowAction(row: FormulaRow, resolve: Resolve, readOnly: boolean): RowAction | null {
  // A missing input opens its own sheet; a viewer adds nothing.
  if (row.value.kind === "missing") {
    if (readOnly || row.value.add == null) return null;
    return resolve({ kind: "edit", field: row.value.add });
  }
  if (row.target == null) return null;
  // A viewer opens no input, and not the purchase's acquisition lines (the investment card's row is static for them).
  if (readOnly && (row.target.kind === "edit" || (row.target.kind === "line" && row.target.line === "acquisition"))) return null;
  return resolve(row.target);
}

/**
 * One sign per figure (FLOW-457): a row that adds or takes away shows its operator by the figure's
 * sign, and the figure without one, so a cost reads "− $8,400", not "− −$8,400".
 */
export function signedRow(row: FormulaRow): { op: Op; value: FigureValue } {
  if ((row.op !== "+" && row.op !== "−") || row.value.kind !== "money" || row.value.minor === 0n) return { op: row.op, value: row.value };
  const minor = row.value.minor;
  return { op: minor < 0n ? "−" : "+", value: { ...row.value, minor: minor < 0n ? -minor : minor } };
}

function FormulaLine({ row, currency, action, result }: { row: FormulaRow; currency: string; action: RowAction | null; result: boolean }) {
  const { op, value } = signedRow(row);
  const body: ReactNode = (
    <>
      <span className="ui-ret-op" aria-hidden="true">{op}</span>
      {op === "" || op === "=" ? null : <span className="sr-only">{OP_WORDS[op]} </span>}
      <span className="ui-ret-text">
        <span className="ui-ret-label">{row.label}</span>
        {row.hint == null ? null : <span className="ui-ret-hint">{row.hint}</span>}
      </span>
      <span className="ui-ret-value">
        <FigureText value={value} currency={currency} addText={action != null} />
      </span>
      {action == null ? null : <span className="ui-ret-go" aria-hidden="true"><ChevronIcon size={18} /></span>}
    </>
  );
  const className = result ? "ui-ret-row ui-ret-result" : "ui-ret-row";
  if (action == null) return <div className={className}>{body}</div>;
  if ("href" in action) return <Link to={action.href} className={`${className} m-press`}>{body}</Link>;
  return <button type="button" className={`${className} m-press`} onClick={action.onClick}>{body}</button>;
}

/** A formula: each part with its operator, each opening where it comes from, then "=". */
export function FormulaList({ formula, currency, resolve, readOnly = false, label, more, listRef }: {
  formula: Formula;
  currency: string;
  resolve: Resolve;
  readOnly?: boolean;
  label?: string;
  /** A row before "=" that shows the rest of the rows (FLOW-460: "עוד N קטגוריות"). */
  more?: ReactNode;
  listRef?: Ref<HTMLUListElement>;
}) {
  return (
    <ul className="ui-ret-formula" aria-label={label} ref={listRef}>
      {formula.rows.map((row) => (
        <li key={row.key}>
          <FormulaLine row={row} currency={currency} action={rowAction(row, resolve, readOnly)} result={row.op === "="} />
        </li>
      ))}
      {more == null ? null : <li>{more}</li>}
      {formula.result == null ? null : (
        <li>
          <FormulaLine row={formula.result} currency={currency} action={null} result />
        </li>
      )}
    </ul>
  );
}

/**
 * FLOW-1047 (board V3-Calc): one block of a calculation page: a 20px card, a 44px head (its name, and its
 * figure at the end), then its rows with their operators. It does not fold.
 */
export function CalcSection({ title, total, children }: { title: string; total: ReactNode; children: ReactNode }) {
  return (
    <section className="ui-ret-calc" aria-label={title}>
      <div className="ui-ret-calc-head">
        <h2 className="ui-ret-calc-title">{title}</h2>
        {total == null ? null : <span className="ui-ret-calc-total">{total}</span>}
      </div>
      {children}
    </section>
  );
}

/** "כל הכסף חזר · יצא $30,000 יותר משנכנס": the meta under ∞. */
export function AllCashOutMeta({ minor, currency }: { minor: bigint; currency: string }) {
  return <>{"כל הכסף חזר · יצא "}<Amount agorot={minor} currency={currency} />{" יותר משנכנס"}</>;
}

/** The figure a page leads with, 40/400, and its meta line. */
export function ReturnsHero({ figure, meta }: { figure: ReactNode; meta: ReactNode }) {
  return (
    <div className="ui-ret-hero">
      <span className="ui-ret-hero-figure t-detail">{figure}</span>
      <span className="ui-ret-hero-meta">{meta}</span>
    </div>
  );
}

/** Money in is green with "+" on the income line only; a refund elsewhere is "+" in the text colour. */
function rowSign(line: ReturnLine, minor: bigint): "in" | "out" | "moved-in" {
  if (minor < 0n) return "out";
  return line === "income" ? "in" : "moved-in";
}

function rowHint(row: ReturnLineRow): string {
  const date = `${row.date.slice(8, 10)}/${row.date.slice(5, 7)}`;
  return row.categoryName == null ? date : `${date} · ${row.categoryName}`;
}

/** A month's head line: its count and its sum, signed as the rows are ("4 · +$330"). */
export function monthSummary(rows: readonly ReturnLineRow[], line: ReturnLine, currency: string): ReactNode {
  const sum = rows.reduce((total, row) => total + row.minor, 0n);
  const income = line === "income" || sum > 0n;
  return (
    <>
      <bdi dir="ltr">{String(rows.length)}</bdi>
      {" · "}
      <Amount agorot={sum} currency={currency} income={income && sum > 0n} />
    </>
  );
}

function TransactionGroups({ rows, line, currency, search, idPrefix }: { rows: readonly ReturnLineRow[]; line: ReturnLine; currency: string; search: string; idPrefix: string }) {
  const groups = linesByMonth(rows.map((row) => ({ ...row, doc_date: row.date })));
  // FLOW-1047: each month under the one-line sticky head: its name, then its count and sum.
  return groups.map((group) => (
    <section key={group.key} className="ui-month ui-ret-month" aria-labelledby={`${idPrefix}-${group.key}`}>
      <GroupHead id={`${idPrefix}-${group.key}`} title={group.title} summary={monthSummary(group.rows, line, currency)} />
      <List layout="flat">
        {group.rows.map((row) => (
          <ListRow
            key={`${row.transactionId}:${row.categoryId ?? ""}`}
            layout="flat"
            variant="transaction"
            title={row.supplierName ?? row.description}
            hint={rowHint(row)}
            agorot={row.minor}
            currency={currency}
            sign={rowSign(line, row.minor)}
            source={rowSource(row.source)}
            initials={lineInitials(row.supplierName ?? row.description)}
            href={`/transactions/${row.transactionId}${search}`}
          />
        ))}
      </List>
    </section>
  ));
}

/**
 * A figure's transactions, newest first by month, 50 at a time ("עוד N תנועות"). A transaction opens its
 * own page, where its category or project changes with the pickers there. `sample` draws one page.
 */
export function ReturnLinesSection({ projectId, line, categoryId, currency, search, sample, sectionRef }: {
  projectId: string;
  line: ReturnLine;
  categoryId: string | null;
  currency: string;
  search: string;
  sample?: ReturnLinesPage;
  /** The section a row of the calculation moves the focus to (its bank lines are these). */
  sectionRef?: Ref<HTMLElement>;
}) {
  const idPrefix = useId();
  const read = usePropertyReturnLinesQuery(projectId, line, categoryId, sample == null);
  const pages = sample == null ? read.data?.pages : [sample];
  const rows = pages?.flatMap((page) => page.rows) ?? null;
  const filtered = sample != null && categoryId != null && rows != null ? rows.filter((row) => row.categoryId === categoryId) : rows;
  const count = sample != null && categoryId != null ? (filtered?.length ?? 0) : (pages?.[0]?.count ?? 0);
  const left = Math.max(0, count - (filtered?.length ?? 0));
  const more = sample == null ? read.hasNextPage : left > 0;
  let body: ReactNode;
  if (filtered == null) {
    body = read.isError
      ? <FailureLine offline={read.isPaused} onRetry={() => { void read.refetch(); }} />
      : <DelayedSkeleton><ProfitRowsSkeleton /></DelayedSkeleton>;
  } else if (filtered.length === 0) {
    body = <p className="ui-ret-empty">אין תנועות בתקופה.</p>;
  } else {
    body = (
      <>
        <TransactionGroups rows={filtered} line={line} currency={currency} search={search} idPrefix={idPrefix} />
        {more ? (
          <div className="ui-rep-more-wrap">
            <Button
              variant="secondary"
              busy={read.isFetchingNextPage}
              onClick={() => { if (sample == null) void read.fetchNextPage(); }}
            >
              {left === 1 ? "עוד תנועה אחת" : `עוד ${String(left)} תנועות`}
            </Button>
          </div>
        ) : null}
        {read.isFetchNextPageError ? <FailureLine offline={read.isPaused} onRetry={() => { void read.fetchNextPage(); }} /> : null}
      </>
    );
  }
  // FLOW-1047 (board V3-Calc): the months under their own heads, no section card around them.
  return (
    <section className="ui-ret-lines" aria-label="תנועות" tabIndex={-1} ref={sectionRef}>
      {body}
    </section>
  );
}

/** Which input an edit link names, from `?edit=`; null for anything else. */
export function editFieldOf(value: string | null): EditField | null {
  if (value === "purchase" || value === "arv" || value === "value" || value === "land" || value === "units" || value === "tax_bracket") return value;
  return null;
}
