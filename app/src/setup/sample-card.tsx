import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { REVIEW_APPROVE, REVIEW_APPROVED, REVIEW_META } from "./copy";

/**
 * The step 6 sample line (FLOW-514 §3, Q4: the board's compact card, not FLOW-365's queue card). It
 * writes nothing: the approval only changes what this card shows; the caller stamps the setup store.
 */
export function SampleCard({ approved, busy = false, onApprove }: { approved: boolean; busy?: boolean; onApprove: () => void }) {
  return (
    <Card as="section" className={approved ? "ui-sample ui-sample-approved" : "ui-sample"} aria-label="שורת דוגמה">
      <div className="ui-sample-head">
        <span className="ui-sample-name">Northline Supply</span>
        <bdi className="ui-sample-amount ui-num" dir="ltr">−$409.01</bdi>
      </div>
      <p className="ui-sample-meta t-hint">{REVIEW_META}</p>
      <div className="ui-sample-chips">
        <span className="ui-sample-chip">Birch Lane</span>
        <span className="ui-sample-chip">חומרים</span>
      </div>
      {approved ? (
        <p className="ui-sample-done t-label" role="status">{REVIEW_APPROVED}</p>
      ) : (
        <Button type="button" full busy={busy} onClick={onApprove}>{REVIEW_APPROVE}</Button>
      )}
    </Card>
  );
}
