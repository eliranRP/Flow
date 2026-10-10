import type { Ref } from "react";
import { Avatar, MailAvatar } from "./avatar";
import { ListRow } from "./list-row";

/**
 * FLOW-601 (mockups a-1, invite-2). One person on the team page: the 40px initials circle, the
 * name, and the role under it. A pending invite shows the envelope and the email (LTR) with
 * "הוזמנה · role". A row that opens a sheet carries the chevron; the owner's row is static.
 */
export function PersonRow({
  name,
  hint,
  invite = false,
  onOpen,
  buttonRef,
  label,
}: {
  /** The member's name, or the invite's email. */
  name: string;
  /** The role, or "הוזמנה · role". */
  hint: string;
  invite?: boolean;
  onOpen?: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
  /** The row's accessible name when it opens a sheet. */
  label?: string;
}) {
  const icon = invite ? <MailAvatar /> : <Avatar name={name} fallback="person" />;
  if (onOpen == null) {
    return <ListRow variant="static" className="ui-person-row" title={name} ltrTitle={invite} hint={hint} icon={icon} />;
  }
  return (
    <ListRow
      variant="button"
      className="ui-person-row"
      title={name}
      ltrTitle={invite}
      hint={hint}
      icon={icon}
      chevron
      label={label ?? `${name}, ${hint}`}
      buttonRef={buttonRef}
      onClick={onOpen}
    />
  );
}
