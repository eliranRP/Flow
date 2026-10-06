import type { ReactNode } from "react";
import { List, ListRow } from "../ui/list-row";
import { ProgressBar } from "../ui/progress-bar";
import { TextLink } from "../ui/text-link";
import { SETUP_TOTAL, STEP_TITLE } from "./copy";
import type { CountedStep } from "./model";

function OpenRing() {
  return <span className="ui-setup-ring" aria-hidden="true" />;
}

export function SetupCard({
  done,
  steps,
  onDismiss,
}: {
  done: number;
  steps: readonly CountedStep[];
  onDismiss: () => void;
}) {
  return (
    <section className="ui-setup-card" aria-labelledby="setup-card-title">
      <div className="ui-setup-card-head">
        <h2 id="setup-card-title" className="t-title-3">
          הגדרה · <bdi className="ui-num" dir="ltr">{String(done)}</bdi> מתוך <bdi className="ui-num" dir="ltr">{String(SETUP_TOTAL)}</bdi>
        </h2>
        <TextLink tone="quiet" chevron={false} onClick={onDismiss}>הסתרה</TextLink>
      </div>
      <div className="ui-setup-card-meter">
        <ProgressBar variant="thin" value={done} max={SETUP_TOTAL} label="התקדמות ההגדרה" />
      </div>
      <List>
        {steps.map((step) => (
          <ListRow
            key={step}
            variant="item"
            href={`/setup/${String(step)}?from=card`}
            icon={<OpenRing />}
            title={STEP_TITLE[step] ?? ""}
            chevron
          />
        ))}
        <ListRow
          variant="item"
          href="/settings?sheet=assistant"
          title={<span className="ui-setup-card-advanced">מתקדם · עוזר AI</span>}
          label="מתקדם · עוזר AI"
          chevron
        />
      </List>
    </section>
  );
}

export function CountTitle({ count, one, many }: { count: number; one: string; many: string }) {
  if (count === 1) return one;
  return (
    <>
      <bdi className="ui-num" dir="ltr">{String(count)}</bdi> {many}
    </>
  );
}

export function NameHint({ head, rest }: { head: string; rest: number }): ReactNode {
  if (head === "" && rest === 0) return null;
  return (
    <>
      {head}
      {rest > 0 ? <> ועוד <bdi className="ui-num" dir="ltr">{String(rest)}</bdi></> : null}
    </>
  );
}
