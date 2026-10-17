import type { ReactNode } from "react";
import { ScreenHeader } from "./screen-header";

/**
 * The shared shape of a connection page (FLOW-512, implementation-guide §7.14): the title with one
 * line on what comes in, an optional tinted box for a reconnect, then the page's blocks. Used by
 * SUMIT, Mercury and the AI page, and by onboarding (FLOW-514). It has no route code: the screen
 * passes the back target and its blocks.
 */
export function ConnectionPage({
  title,
  subtitle,
  backTo,
  problem,
  children,
}: {
  title: string;
  subtitle: string;
  /** Back goes to the connections list (חיבורים) or to onboarding. */
  backTo: string;
  backText?: string;
  /** The tinted box a reconnect opens with: what stopped, and that what came in is kept. */
  problem?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="ui-connection-page">
      <ScreenHeader title={title} subtitle={subtitle} backTo={backTo} backText="חיבורים" />
      {problem != null ? <div className="ui-connection-problem" role="status">{problem}</div> : null}
      {children}
    </div>
  );
}

/** A numbered head above a card or a field group: "1 · מוצאים את הפרטים ב־SUMIT". */
export function ConnectionHead({ children }: { children: ReactNode }) {
  return <h2 className="ui-settings-head">{children}</h2>;
}

/** The grey line under a card or a field group (13px, muted). */
export function ConnectionNote({ children }: { children: ReactNode }) {
  return <p className="ui-settings-note">{children}</p>;
}

/** The numbered steps card. Each step is one line of the guide, with its number in a small circle. */
export function StepList({ steps }: { steps: readonly string[] }) {
  return (
    <ol className="ui-step-list">
      {steps.map((step, index) => (
        <li key={step} className="ui-step-item">
          <span className="ui-install-num" aria-hidden="true">{String(index + 1)}</span>
          <span className="ui-step-text">{step}</span>
        </li>
      ))}
    </ol>
  );
}

/** A connected page's facts: a label on the start side, the value on the end side, a line between rows. */
export function ConnectionFacts({ rows }: { rows: readonly { label: string; value: ReactNode; ltr?: boolean }[] }) {
  return (
    <dl className="ui-connection-facts">
      {rows.map((row) => (
        <div key={row.label} className="ui-connection-fact">
          <dt>{row.label}</dt>
          <dd dir={row.ltr === true ? "ltr" : undefined}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
