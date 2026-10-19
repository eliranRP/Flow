import { Amount } from "../ui/amount";
import { Card } from "../ui/card";
import { List, ListRow } from "../ui/list-row";
import type { CashRow } from "../ui/cash-rows";

type Figure = { currency: string; minor: bigint };

function Figures({ figures }: { figures: Figure[] }) {
  return (
    <span className="ui-project-figures">
      {figures.map((figure) => (
        <Amount
          key={figure.currency}
          agorot={figure.minor}
          currency={figure.currency}
          presentation="detail"
          size="list"
          // The board: a profit row signs a gain in the text colour.
          direction={figure.minor > 0n ? "income" : undefined}
          loss={figure.minor < 0n}
        />
      ))}
    </span>
  );
}

/** The project page's profit card (board): this month's profit and the profit since the start, each with its line. */
export function ProjectProfitCard({
  monthName,
  monthLabel,
  month,
  since,
  sinceHint,
  monthHref,
  sinceHref,
  extra,
}: {
  monthName: string;
  /** Read in full by a screen reader: "רווח באוקטובר $… – פירוט". */
  monthLabel?: string;
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
        <ListRow variant="item" title={`רווח ${monthName}`} hint="הכנסות פחות הוצאות שנספרות ברווח" meta={<Figures figures={month} />} href={monthHref} label={monthLabel} chevron />
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

/** A project with nothing filed yet: what will appear here, and that suppliers are remembered. */
export function ProjectEmptyCard() {
  return (
    <Card className="ui-project-card ui-project-empty-card">
      <h2 className="ui-project-card-title">אין עדיין תנועות</h2>
      <p>חשבוניות ותשלומים שישויכו לפרויקט הזה יופיעו כאן. ספקים שתשייך לכאן ייזכרו להבא.</p>
    </Card>
  );
}
