import { RadioRow } from "./radio-row";

/** FLOW-601. The roles a member can have, in the order they are listed (צופה first: the default). */
export type RoleChoiceValue = "viewer" | "editor";

export const ROLE_CHOICE_LABEL: Record<RoleChoiceValue, string> = { viewer: "צופה", editor: "עורך" };
/** The owner's pick (2026-10-09): צופה is "צפייה בלבד". */
export const ROLE_CHOICE_HINT: Record<RoleChoiceValue, string> = { viewer: "צפייה בלבד", editor: "יכול לשייך ולשנות" };
const ORDER: readonly RoleChoiceValue[] = ["viewer", "editor"];

/**
 * צופה / עורך as radio rows. The invite sheet shows each role's hint; the member sheet leaves
 * it out (mockup a-2) and applies a tap at once, so the row being saved shows the spinner and
 * the other one waits.
 */
export function RoleChoice({
  value,
  onChange,
  hints = false,
  busy = null,
  disabled = false,
  label = "תפקיד",
}: {
  value: RoleChoiceValue;
  onChange: (role: RoleChoiceValue) => void;
  hints?: boolean;
  /** The role being saved. */
  busy?: RoleChoiceValue | null;
  disabled?: boolean;
  /** The group's accessible name. */
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="ui-role-choice">
      {ORDER.map((role) => (
        <RadioRow
          key={role}
          label={ROLE_CHOICE_LABEL[role]}
          hint={hints ? ROLE_CHOICE_HINT[role] : undefined}
          selected={busy == null ? value === role : false}
          busy={busy === role}
          disabled={disabled || (busy != null && busy !== role)}
          onSelect={() => {
            if (role !== value) onChange(role);
          }}
        />
      ))}
    </div>
  );
}
