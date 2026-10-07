import type { ReactNode, Ref } from "react";
import { AlertIcon } from "./icons";
import { ListRow } from "./list-row";
import { Skeleton } from "./skeleton";
import { TextLink } from "./text-link";

export type ConnectorRetry = {
  /** The status line, "לא הצלחנו לטעון" or "שגיאה". It is a polite status. */
  hint: ReactNode;
  /** The link's accessible name, "ניסיון חוזר: SUMIT". */
  label: string;
  busy?: boolean;
  retryRef?: Ref<HTMLButtonElement>;
  onRetry?: () => void;
};

export type ConnectorRowProps = {
  title: string;
  icon: ReactNode;
  state: "loading" | "error" | "ready";
  /** The one-word status when ready: מחובר, לא מחובר, צריך לחבר מחדש. */
  hint?: ReactNode;
  /** Reconnect: warning tone and the alert icon. */
  warning?: boolean;
  /** The owner opens the connector's sheet. Without it the row is static (viewer). */
  onOpen?: () => void;
  /** A row that names why it cannot open (no company). It stays focusable. */
  ariaDisabled?: boolean;
  rowRef?: Ref<HTMLButtonElement>;
  retry?: ConnectorRetry;
};

/**
 * One connector on the Connections page (FLOW-501). Loading keeps the real
 * title over a skeleton hint. Error has an inline ניסיון חוזר (0082 §4). Ready
 * is a button with a chevron for the owner and a static row for a viewer.
 */
export function ConnectorRow({ title, icon, state, hint, warning = false, onOpen, ariaDisabled = false, rowRef, retry }: ConnectorRowProps) {
  if (state === "loading") {
    return <ListRow variant="static" title={title} icon={icon} hint={<Skeleton width="sm" />} skelHint busy />;
  }
  if (state === "error") {
    return (
      <ListRow
        variant="static"
        title={title}
        icon={<AlertIcon size={24} />}
        tone="muted"
        describeHint
        hintStatus
        hint={retry?.hint ?? "לא הצלחנו לטעון"}
        action={retry?.onRetry ? (
          <TextLink
            size="label"
            chevron={false}
            label={retry.label}
            busy={retry.busy === true}
            buttonRef={retry.retryRef}
            onClick={retry.onRetry}
          >
            ניסיון חוזר
          </TextLink>
        ) : undefined}
      />
    );
  }
  const shownIcon = warning ? <AlertIcon size={24} /> : icon;
  const tone = warning ? ("warning" as const) : undefined;
  if (ariaDisabled) {
    return (
      <ListRow
        variant="button"
        title={title}
        hint={hint}
        icon={shownIcon}
        tone={tone}
        wrapHint
        describeHint
        clearHint
        ariaDisabled
        className="ui-row-ring"
        buttonRef={rowRef}
      />
    );
  }
  if (onOpen == null) {
    return <ListRow variant="static" title={title} hint={hint} icon={shownIcon} tone={tone} describeHint wrapHint />;
  }
  return (
    <ListRow
      variant="button"
      title={title}
      hint={hint}
      icon={shownIcon}
      tone={tone}
      chevron
      describeHint
      wrapHint
      className="ui-row-ring"
      buttonRef={rowRef}
      onClick={onOpen}
    />
  );
}
