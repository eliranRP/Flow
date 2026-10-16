import type { Ref } from "react";
import { Avatar, MailAvatar } from "./avatar";
import { ListRow } from "./list-row";

/**
 * FLOW-601, FLOW-512. One person on the team page: the icon, the name, and the role at the end
 * (muted). A pending invite shows the envelope and the email (LTR) with "הוזמן · ממתין" in the
 * accent colour. A row that opens a sheet carries the chevron; the owner's row is static.
 */
export function PersonRow({
  name,
  value,
  invite = false,
  onOpen,
  buttonRef,
  label,
}: {
  /** The member's name, or the invite's email. */
  name: string;
  /** The role at the end, or "הוזמן · ממתין" for a pending invite. */
  value: string;
  invite?: boolean;
  onOpen?: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
  /** The row's accessible name when it opens a sheet. */
  label?: string;
}) {
  const icon = invite ? <MailAvatar /> : <Avatar name={name} fallback="person" />;
  const shown = invite ? <span className="ui-row-value-accent">{value}</span> : value;
  if (onOpen == null) {
    return <ListRow variant="static" className="ui-person-row" title={name} ltrTitle={invite} value={shown} icon={icon} />;
  }
  return (
    <ListRow
      variant="button"
      className="ui-person-row"
      title={name}
      ltrTitle={invite}
      value={shown}
      icon={icon}
      chevron
      label={label ?? `${name}, ${value}`}
      buttonRef={buttonRef}
      onClick={onOpen}
    />
  );
}
