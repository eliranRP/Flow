import "../ui/lazy.css";
import { formatAmountText } from "@flow/shared";
import { useState } from "react";
import { LEDGER_KEYS } from "../ledger-keys";
import { usePreviewSearch, useHomePreview } from "../preview";
import { screenPhase } from "../query-phase";
import { liveRpcClient } from "../recurring-actions";
import { answerTransferMatch, transferAccountName, transferMatchKey, useTransferMatchesQuery, type TransferMatch, type TransferSide } from "../transfer-matches";
import { useInvalidateBooks } from "../use-books";
import { useHoldWrites } from "../use-is-viewer";
import { Button } from "../ui/button";
import { formatDayMonth } from "../ui/date-math";
import { EmptyState } from "../ui/empty-state";
import { HintParts } from "../ui/hint-parts";
import { CheckIcon } from "../ui/icons";
import { ScreenState } from "../ui/screen-state";
import { Skeleton } from "../ui/skeleton";
import { useToast } from "../ui/toast";
// The pair cards' own CSS; none of it is in Home's first load.
import "../ui/css/54-transfer-matches.css";

const FAILED = "לא הצלחנו לעדכן את השורות.";

/** "יום אחד בין השורות" / "באותו יום", and the name hint when one side names the other organisation. */
function pairNote(match: TransferMatch): string {
  const days = match.day_diff === 0 ? "באותו יום" : match.day_diff === 1 ? "יום אחד בין השורות" : `${String(match.day_diff)} ימים בין השורות`;
  return match.name_hint ? `${days} · השם תואם` : days;
}

function TransferLeg({ side, income }: { side: TransferSide; income: boolean }) {
  // Cents show when there are any: the two lines match to the cent.
  const amount = formatAmountText(side.amount_minor, side.currency, { detail: true });
  return (
    <li className="ui-xfer-leg">
      <span className="ui-xfer-leg-text">
        <span className="ui-xfer-leg-title">
          {income ? "נכנס ל־" : "יצא מ־"}
          <bdi dir="ltr">{transferAccountName(side)}</bdi>
        </span>
        <span className="ui-xfer-leg-meta">
          <HintParts parts={[
            ...(side.org_label != null ? [<bdi key="org" dir="ltr">{side.org_label}</bdi>] : []),
            <bdi key="date">{formatDayMonth(side.doc_date)}</bdi>,
          ]} />
        </span>
      </span>
      <bdi dir="ltr" className="ui-xfer-leg-amount" data-income={income ? "true" : undefined}>{income ? `+${amount}` : amount}</bdi>
    </li>
  );
}

/**
 * FLOW-1049 (V3-Transfers): one pair card. The money out and the money in as two rows, why Flow pairs them,
 * and the two answers side by side (none for a viewer). The question is the card's hidden heading.
 */
export function TransferMatchCard({ match, readOnly, onAnswer }: { match: TransferMatch; readOnly: boolean; onAnswer: (same: boolean) => void }) {
  return (
    <section className="ui-xfer-card" aria-label={`העברה אפשרית: ${formatAmountText(match.out.amount_minor, match.out.currency, { detail: true })}`}>
      <h2 className="sr-only">זו העברה בין החשבונות שלכם?</h2>
      <ul className="ui-xfer-legs">
        <TransferLeg side={match.out} income={false} />
        <TransferLeg side={match.in} income />
      </ul>
      <p className="ui-xfer-why"><HintParts text={pairNote(match)} /></p>
      {readOnly ? null : (
        <div className="ui-xfer-actions">
          <Button onClick={() => { onAnswer(true); }}>כן, העברה</Button>
          <Button variant="secondary" onClick={() => { onAnswer(false); }}>לא, צירוף מקרים</Button>
        </div>
      )}
    </section>
  );
}

/**
 * FLOW-1139: the page while the pairs load, in its shape: the lead line, then two pair cards, each the money out
 * and the money in as two rows, the reason line and the two answers. One sr-only line says it is loading.
 */
function TransfersSkeleton() {
  return (
    <div className="ui-page-pad ui-xfer-page" aria-busy="true">
      <p className="sr-only" role="status">טוען…</p>
      <span className="ui-xfer-skel-lead">
        <Skeleton width="lg" />
        <Skeleton width="md" />
      </span>
      {[0, 1].map((card) => (
        <div key={card} className="ui-xfer-card">
          {[0, 1].map((leg) => (
            <span key={leg} className="ui-xfer-leg">
              <span className="ui-xfer-skel-text">
                <Skeleton width="md" />
                <Skeleton width="sm" />
              </span>
              <Skeleton width="sm" />
            </span>
          ))}
          <p className="ui-xfer-why"><Skeleton width="md" /></p>
          <span className="ui-xfer-actions">
            <span aria-hidden="true" className="ui-skeleton-bar ui-xfer-skel-answer" />
            <span aria-hidden="true" className="ui-skeleton-bar ui-xfer-skel-answer" />
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * העברות לבדיקה (FLOW-941, decision 0205; FLOW-1049 V3-Transfers, the List pattern), opened from Home's דורש טיפול row. Each card is a pair Flow
 * suggests: money out on one Mercury connection and the same amount in on another. כן files both lines as a
 * transfer (out of income and expenses); לא stops the suggestion. Both toast with ביטול. `sample` draws the
 * dev route and the stories, with local answers only.
 */
export function TransfersScreen({ sample }: { sample?: TransferMatch[] } = {}) {
  const live = sample == null;
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const query = useTransferMatchesQuery(live);
  const holdWrites = useHoldWrites();
  const toast = useToast();
  const invalidate = useInvalidateBooks();
  // Answered here: hidden at once, back on ביטול or a failed write.
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const all = live ? (query.data ?? []) : sample;
  const rows = all.filter((match) => !answered.has(transferMatchKey(match)));
  const loaded = live ? screenPhase(preview, query) : ({ kind: "ready" } as const);
  const phase = loaded.kind === "ready" && rows.length === 0 ? ({ kind: "empty" } as const) : loaded;

  const mark = (key: string, hidden: boolean) => {
    setAnswered((before) => {
      const next = new Set(before);
      if (hidden) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  async function write(match: TransferMatch, same: boolean | null): Promise<boolean> {
    try {
      if (live) await answerTransferMatch(liveRpcClient(), match, same);
    } catch {
      toast.show({ tone: "bad", message: FAILED });
      return false;
    }
    if (live) void invalidate(LEDGER_KEYS);
    return true;
  }

  async function answer(match: TransferMatch, same: boolean) {
    const key = transferMatchKey(match);
    mark(key, true);
    if (!(await write(match, same))) {
      mark(key, false);
      return;
    }
    toast.show({ message: same ? "סומן כהעברה" : "לא נציע שוב", action: "ביטול", onAction: () => void undo(match) });
  }

  async function undo(match: TransferMatch) {
    const key = transferMatchKey(match);
    if (!(await write(match, null))) return;
    mark(key, false);
    toast.show({ message: "ההצעה חזרה לרשימה" });
  }

  return (
    <ScreenState
      title="העברות לבדיקה"
      subtitle={rows.length === 1 ? "זוג אחד לבדיקה" : `${String(rows.length)} זוגות לבדיקה`}
      kicker="בית"
      backTo={`/${search}`}
      phase={phase}
      onRetry={() => void query.refetch()}
      loading={<TransfersSkeleton />}
      empty={(
        <div className="ui-page-pad">
          <EmptyState
            icon={<CheckIcon size={40} stroke={2.2} />}
            title="אין העברות לבדיקה"
            body="כשסכום יוצא מחיבור Mercury אחד ונכנס לחיבור אחר, נשאל כאן אם זו העברה."
            action={<Button full to={`/${search}`}>חזרה לבית</Button>}
          />
        </div>
      )}
    >
      <div className="ui-page-pad ui-xfer-page">
        <p className="ui-xfer-lead">אותו סכום יצא מחשבון אחד ונכנס לחשבון אחר. העברה בין החשבונות שלכם לא נספרת כהכנסה או כהוצאה.</p>
        {rows.map((match) => (
          <TransferMatchCard key={transferMatchKey(match)} match={match} readOnly={holdWrites && live} onAnswer={(same) => void answer(match, same)} />
        ))}
      </div>
    </ScreenState>
  );
}
