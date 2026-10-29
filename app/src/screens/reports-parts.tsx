import { useId, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Amount } from "../ui/amount";
import { AlertIcon, CheckIcon, ChevronDownIcon, ChevronIcon } from "../ui/icons";
import {
  accountName,
  balanceWarning,
  categoryName,
  equityTotal,
  marginPercent,
  projectKeyName,
  type BalanceCurrency,
  type BalanceSide,
  type StatementCurrency,
  type StatementNode,
  type StatementProject,
} from "../reports";

/**
 * FLOW-161: the reports screen's parts (board row "דוחות"): a collapsible section whose total stays on its
 * header, the P&L statement, the by-project cards and the balance sheet. The screen holds which sections are
 * collapsed (remembered per report) and passes `isOpen` and `onToggle`.
 */

export type Collapse = { isOpen: (id: string) => boolean; onToggle: (id: string) => void };

/** A section's head: the chevron turns, the title, and the total that stays in view when it is closed. */
export function ReportSection({ id, title, total, collapse, children, tone = "section" }: {
  id: string;
  title: string;
  total: ReactNode;
  collapse: Collapse;
  children: ReactNode;
  /** A parent category inside a section is a step smaller. */
  tone?: "section" | "group";
}) {
  const bodyId = useId();
  const open = collapse.isOpen(id);
  return (
    <section className={tone === "section" ? "ui-rep-section" : "ui-rep-group"} aria-label={title}>
      <button type="button" className="ui-rep-head" aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={() => { collapse.onToggle(id); }}>
        <span className="ui-chevron-turn ui-rep-chevron" data-open={open ? "true" : "false"} aria-hidden="true">
          <ChevronDownIcon size={16} />
        </span>
        <span className="ui-rep-head-title" dir="auto">{title}</span>
        <span className="ui-rep-head-total">{total}</span>
      </button>
      {open ? <div id={bodyId} className="ui-rep-body">{children}</div> : null}
    </section>
  );
}

/** One row: a name and an amount, a link when it opens its lines. */
export function ReportRow({ name, meta, amount, href }: { name: string; meta?: string; amount: ReactNode; href?: string }) {
  const content = (
    <>
      <span className="ui-rep-row-text">
        <span className="ui-rep-row-name" dir="auto">{name}</span>
        {meta ? <span className="ui-rep-row-meta">{meta}</span> : null}
      </span>
      <span className="ui-rep-row-amount">{amount}</span>
      {href != null ? <span className="ui-rep-row-go" aria-hidden="true"><ChevronIcon size={16} /></span> : null}
    </>
  );
  return <li className="ui-rep-row">{href != null ? <Link className="ui-rep-row-link m-press" to={href}>{content}</Link> : <div className="ui-rep-row-link">{content}</div>}</li>;
}

/** A bold line under a section: a subtotal, or the bottom line in `strong`. */
export function ReportTotal({ label, amount, strong = false }: { label: string; amount: ReactNode; strong?: boolean }) {
  return (
    <div className={strong ? "ui-rep-total ui-rep-total-strong" : "ui-rep-total"}>
      <span>{label}</span>
      <span className="ui-rep-total-amount">{amount}</span>
    </div>
  );
}

/** The number that leads a report: the net profit or the equity, capped at the total step (rule tables § 19). */
export function ReportSummary({ label, amount, currency, sub, ok = false, loss = amount < 0n }: {
  label: string;
  amount: bigint;
  currency: string;
  sub: string;
  ok?: boolean;
  /** A net below zero is a loss; a side's total (the drill-down's expenses) is not. */
  loss?: boolean;
}) {
  return (
    <div className="ui-rep-summary">
      <span className="ui-rep-summary-label">{label}</span>
      <p className="ui-rep-summary-figure">
        <Amount agorot={amount} currency={currency} size="total" loss={loss} />
      </p>
      <span className="ui-rep-summary-sub">
        {ok ? <span className="ui-rep-ok" aria-hidden="true"><CheckIcon size={16} /></span> : null}
        {sub}
      </span>
    </div>
  );
}

function costAmount(minor: bigint, currency: string): ReactNode {
  // A cost shows its minus (decision 0096); a refund that leaves a side below zero shows a plus.
  return <Amount agorot={-minor} currency={currency} />;
}

function incomeAmount(minor: bigint, currency: string): ReactNode {
  return <Amount agorot={minor} currency={currency} />;
}

type DrillHref = (side: "income" | "expense", node: { id: string | null; name: string | null }) => string;

function sideRows(row: StatementCurrency, side: "income" | "expense", collapse: Collapse, drill: DrillHref, prefix: string): ReactNode {
  const amount = (minor: bigint) => (side === "income" ? incomeAmount(minor, row.currency) : costAmount(minor, row.currency));
  const nodes: StatementNode[] = row[side];
  return (
    <ul className="ui-rep-rows">
      {nodes.map((node) => {
        if (node.children.length === 0) {
          return <ReportRow key={node.id ?? "none"} name={categoryName(node.name)} amount={amount(node.amount_minor)} href={drill(side, node)} />;
        }
        return (
          <li key={node.id ?? "none"} className="ui-rep-row ui-rep-row-group">
            <ReportSection id={`${prefix}${row.currency}:${side}:${node.id ?? "none"}`} title={categoryName(node.name)} total={amount(node.amount_minor)} collapse={collapse} tone="group">
              <ul className="ui-rep-rows ui-rep-rows-sub">
                {node.own_minor !== 0n ? <ReportRow name={categoryName(node.name)} meta="ישירות בקטגוריה" amount={amount(node.own_minor)} href={drill(side, node)} /> : null}
                {node.children.map((child) => <ReportRow key={child.id ?? "none"} name={categoryName(child.name)} amount={amount(child.amount_minor)} href={drill(side, child)} />)}
              </ul>
            </ReportSection>
          </li>
        );
      })}
    </ul>
  );
}

/** Where a kept-out category posts: the account when its name differs, else its type. */
function keptMeta(item: StatementCurrency["kept_out"][number]): string | undefined {
  const account = item.account_name == null ? null : accountName({ name: item.account_name, is_system: true });
  if (account != null && account !== item.name) return account;
  if (item.account_type === "asset") return "נכס";
  if (item.account_type === "liability") return "התחייבות";
  if (item.account_type === "equity") return "הון";
  return undefined;
}

/** One currency's P&L: income, expenses, the net, and what stays out of profit. */
export function StatementView({ row, collapse, drill, prefix = "" }: { row: StatementCurrency; collapse: Collapse; drill: DrillHref; prefix?: string }) {
  const kept = row.kept_out;
  return (
    <div className="ui-rep-statement">
      {row.income.length > 0 ? (
        <ReportSection id={`${prefix}${row.currency}:income`} title="הכנסות" total={incomeAmount(row.income_minor, row.currency)} collapse={collapse}>
          {sideRows(row, "income", collapse, drill, prefix)}
        </ReportSection>
      ) : null}
      {row.expense.length > 0 ? (
        <ReportSection id={`${prefix}${row.currency}:expense`} title="הוצאות" total={costAmount(row.expense_minor, row.currency)} collapse={collapse}>
          {sideRows(row, "expense", collapse, drill, prefix)}
        </ReportSection>
      ) : null}
      <ReportTotal label="רווח נקי" amount={<Amount agorot={row.net_minor} currency={row.currency} loss={row.net_minor < 0n} />} strong />
      {kept.length > 0 ? (
        <ReportSection id={`${prefix}${row.currency}:kept`} title="לא נספר ברווח" total={<span className="t-muted">{kept.length === 1 ? "קטגוריה אחת" : `${String(kept.length)} קטגוריות`}</span>} collapse={collapse}>
          <ul className="ui-rep-rows ui-rep-rows-kept">
            {kept.map((item) => (
              <ReportRow
                key={`${item.direction}:${item.id ?? "none"}`}
                name={categoryName(item.name)}
                meta={keptMeta(item)}
                amount={item.direction === "income" ? <Amount agorot={item.amount_minor} currency={row.currency} /> : costAmount(item.amount_minor, row.currency)}
              />
            ))}
          </ul>
          <p className="ui-rep-note">נכסים והתחייבויות, כמו קנייה של נכס, הלוואה, קרן ואסקרו. הם במאזן, לא ברווח.</p>
        </ReportSection>
      ) : null}
    </div>
  );
}

/** The by-project view: a card per project key, closed by default, with its income, cost and net. */
export function ByProjectView({ projects, currency, collapse, openProject }: {
  projects: readonly StatementProject[];
  currency: string;
  collapse: Collapse;
  openProject: (projectId: string) => string;
}) {
  return (
    <ul className="ui-rep-projects">
      {projects.map((project) => {
        const row = project.currencies.find((item) => item.currency === currency) ?? project.currencies[0];
        if (row == null) return null;
        const id = `project:${project.key}`;
        const name = projectKeyName(project);
        return (
          <li key={project.key} className="ui-rep-project">
            <ReportSection id={id} title={name} total={<Amount agorot={row.net_minor} currency={row.currency} loss={row.net_minor < 0n} />} collapse={{ ...collapse, isOpen: (key) => !collapse.isOpen(key) }}>
              <div className="ui-rep-project-body">
                <ReportTotal label="הכנסות" amount={incomeAmount(row.income_minor, row.currency)} />
                <ReportTotal label="הוצאות" amount={costAmount(row.expense_minor, row.currency)} />
                <ReportTotal label="רווח נקי" amount={<Amount agorot={row.net_minor} currency={row.currency} loss={row.net_minor < 0n} />} strong />
                {project.project_id != null ? (
                  <Link className="ui-rep-more m-press" to={openProject(project.project_id)}>
                    {`הדוח המלא של ${name}`}
                    <ChevronIcon size={16} />
                  </Link>
                ) : null}
              </div>
            </ReportSection>
          </li>
        );
      })}
    </ul>
  );
}

function sideList(side: BalanceSide, currency: string, accountHref: (accountId: string) => string, extra?: ReactNode): ReactNode {
  return (
    <ul className="ui-rep-rows">
      {side.accounts.map((account) => (
        <ReportRow key={account.account_id} name={accountName(account)} amount={<Amount agorot={account.balance_minor} currency={currency} />} href={accountHref(account.account_id)} />
      ))}
      {extra}
    </ul>
  );
}

/**
 * One currency's balance sheet: assets, liabilities and equity (with the running profit), and the check line.
 * An account's row opens its movements (FLOW-165).
 */
export function BalanceView({ row, collapse, fixHref, accountHref }: { row: BalanceCurrency; collapse: Collapse; fixHref: string; accountHref: (accountId: string) => string }) {
  const warning = balanceWarning(row);
  const equity = equityTotal(row);
  return (
    <div className="ui-rep-statement">
      {warning != null ? (
        <div className="ui-rep-warning" role="status">
          <span className="ui-rep-warning-icon" aria-hidden="true"><AlertIcon size={20} /></span>
          <span className="ui-rep-warning-text">
            <span className="ui-rep-warning-title">
              {"בחשבון מעבר · "}
              <Amount agorot={warning.amount} currency={row.currency} />
            </span>
            <span className="ui-rep-warning-body">יש תנועות שהקטגוריה שלהן לא קשורה לחשבון במאזן. אחרי שמסדרים, המספרים מתעדכנים.</span>
            <Link className="ui-rep-warning-action m-press" to={fixHref}>סידור הקטגוריות</Link>
          </span>
        </div>
      ) : null}
      <ReportSection id={`${row.currency}:assets`} title="נכסים" total={<Amount agorot={row.assets.total_minor} currency={row.currency} />} collapse={collapse}>
        {sideList(row.assets, row.currency, accountHref)}
      </ReportSection>
      <ReportSection id={`${row.currency}:liabilities`} title="התחייבויות" total={<Amount agorot={row.liabilities.total_minor} currency={row.currency} />} collapse={collapse}>
        {sideList(row.liabilities, row.currency, accountHref)}
      </ReportSection>
      <ReportSection id={`${row.currency}:equity`} title="הון" total={<Amount agorot={equity} currency={row.currency} loss={equity < 0n} />} collapse={collapse}>
        {sideList(row.equity, row.currency, accountHref, row.retained_earnings_minor !== 0n ? (
          <ReportRow name="רווח שנצבר" meta="מרווח והפסד" amount={<Amount agorot={row.retained_earnings_minor} currency={row.currency} loss={row.retained_earnings_minor < 0n} />} />
        ) : null)}
      </ReportSection>
      <ReportTotal label="התחייבויות והון" amount={<Amount agorot={row.total_liabilities_and_equity_minor} currency={row.currency} />} strong />
    </div>
  );
}

/** The P&L summary line: the margin and the period. */
export function statementSub(row: StatementCurrency, period: string): string {
  const margin = marginPercent(row);
  return margin == null ? period : `${String(margin)}% מההכנסות · ${period}`;
}
