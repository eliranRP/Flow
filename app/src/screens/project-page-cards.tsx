import type { ReactNode } from "react";
import { Amount } from "../ui/amount";
import { Card } from "../ui/card";
import { List, ListRow } from "../ui/list-row";
import type { CashRow } from "../ui/cash-rows";

type Figure = { currency: string; minor: bigint };

function Figures({ figures, detail = true }: { figures: Figure[]; detail?: boolean }) {
  return (
    <span className="ui-project-figures">
      {figures.map((figure) => (
        <Amount
          key={figure.currency}
          agorot={figure.minor}
          currency={figure.currency}
          presentation={detail ? "detail" : "summary"}
          size="list"
          income={figure.minor > 0n}
          loss={figure.minor < 0n}
        />
      ))}
    </span>
  );
}

/** The project page's profit card (board): this month's profit and the profit since the start, each with its line. */
export function ProjectProfitCard({
  monthName,
  month,
  since,
  sinceHint,
  monthHref,
  sinceHref,
  extra,
}: {
  monthName: string;
  month: Figure[];
  since: Figure[] | null;
  sinceHint: string;
  monthHref: string;
  sinceHref: string;
  /** FLOW-418: the cash the profit leaves out, when the month has some. */
  extra?: CashRow;
}) {
  return (
    <Card className="ui-project-card ui-project-profit-card">
      <List>
        <ListRow variant="item" title={`רווח ${monthName}`} hint="הכנסות פחות הוצאות שנספרות ברווח" meta={<Figures figures={month} />} href={monthHref} chevron />
        {since == null ? null : (
          <ListRow variant="item" title="רווח מתחילת הפרויקט" hint={sinceHint} meta={<Figures figures={since} />} href={sinceHref} chevron />
        )}
        {extra?.href == null ? null : (
          <ListRow variant="item" title={extra.label} hint={extra.hint} meta={<span className="ui-project-figures"><Amount agorot={extra.amounts[0]?.minor ?? 0n} currency={extra.amounts[0]?.currency} presentation="detail" size="list" /></span>} href={extra.href} label={extra.name} chevron />
        )}
      </List>
    </Card>
  );
}

/** "חודשים קודמים" as one card: a row per month, its net on the end. */
export function ProjectMonthsCard({ rows, footer }: { rows: CashRow[]; footer?: ReactNode }) {
  return (
    <Card className="ui-project-card ui-project-months-card">
      <h2 className="ui-project-card-title">חודשים קודמים</h2>
      <List>
        {rows.map((row) => (
          <ListRow
            key={row.id}
            variant="item"
            title={row.label}
            meta={<Figures figures={row.amounts} detail={false} />}
            href={row.href}
            label={row.name}
            chevron
          />
        ))}
      </List>
      {footer}
    </Card>
  );
}
