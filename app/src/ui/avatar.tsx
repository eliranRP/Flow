import { initialsOf } from "@flow/shared";
import { BankIcon, DocumentIcon, PeopleIcon } from "./icons";

/**
 * A 36px initials circle in the neutral avatar fill, letters in secondary text (FLOW-305, FLOW-445).
 * Every row uses the same colour. A name with no letter shows the source icon in the same circle.
 * Decorative: the row's accessible name already carries the counterparty.
 */
export function Avatar({ name, fallback }: { name: string; fallback: "bank" | "invoice" | "person" }) {
  const initials = initialsOf(name);
  return (
    <span className="ui-avatar" aria-hidden="true" dir={initials?.dir} data-avatar={initials == null ? "icon" : "letters"}>
      {initials != null
        ? initials.text
        : fallback === "bank"
          ? <BankIcon size={20} />
          : fallback === "person"
            ? <PeopleIcon size={20} />
            : <DocumentIcon size={20} stroke={1.9} />}
    </span>
  );
}
