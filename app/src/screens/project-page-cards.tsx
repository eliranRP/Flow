import { Amount } from "../ui/amount";
import { Card } from "../ui/card";
import { List, ListRow } from "../ui/list-row";

type Figure = { currency: string; minor: bigint };

function Figures({ figures }: { figures: readonly Figure[] }) {
  return (
    <span className="ui-project-figures">
      {figures.map((figure) => (
        <Amount
          key={figure.currency}
          agorot={figure.minor}
          currency={figure.currency}
          presentation="detail"
          size="list"
          // The board: a profit row signs a gain in the income colour.
          direction={figure.minor > 0n ? "income" : undefined}
          loss={figure.minor < 0n}
        />
      ))}
    </span>
  );
}

/** One row of the project page's links: a name, a line under it, an optional figure, and where it opens. */
export type ProjectLink = { id: string; title: string; hint?: string; figures?: readonly Figure[]; text?: string; href: string };

/**
 * FLOW-1044 (board V3-Project): the rows under the kind's card, each one tap to its page: השקעה והלוואות,
 * רווח מתחילת הפרויקט and next month's forecast. A row with no figure shows its line only.
 */
export function ProjectLinks({ links }: { links: readonly ProjectLink[] }) {
  if (links.length === 0) return null;
  return (
    <Card className="ui-project-card ui-project-links">
      <List>
        {links.map((link) => (
          <ListRow
            key={link.id}
            variant="item"
            title={link.title}
            hint={link.hint}
            meta={link.figures != null && link.figures.length > 0
              ? <Figures figures={link.figures} />
              : link.text == null ? undefined : <bdi className="ui-num ui-project-row-figure" dir="ltr">{link.text}</bdi>}
            href={link.href}
            chevron
          />
        ))}
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
