import { initialsOf } from "@flow/shared";
import { BankIcon, DocumentIcon } from "./icons";

/**
 * A 40px initials circle in the tint, letters in accent-text (FLOW-305). Every row uses the same
 * colour. A name with no letter shows the source icon in the same circle. Decorative: the row's
 * accessible name already carries the counterparty.
 */
export function Avatar({ name, fallback }: { name: string; fallback: "bank" | "invoice" }) {
  const initials = initialsOf(name);
  return (
    <span className="ui-avatar" aria-hidden="true" dir={initials?.dir} data-avatar={initials == null ? "icon" : "letters"}>
      {initials != null ? initials.text : fallback === "bank" ? <BankIcon size={20} /> : <DocumentIcon size={20} stroke={1.9} />}
    </span>
  );
}
