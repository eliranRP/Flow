import { Button } from "./button";
import { TextLink } from "./text-link";

/**
 * FLOW-601 (mockups invite-3, invite-4). One invite the signed-in user got: the company, the role
 * and who sent it, then הצטרפות (the tint button) and דחייה (a text link). While one of them runs,
 * the other waits.
 */
export function InviteCard({
  company,
  line,
  busy = null,
  disabled = false,
  onJoin,
  onDecline,
}: {
  company: string;
  /** "עורך · מיוסי כהן". */
  line: string;
  busy?: "join" | "decline" | null;
  /** Another invite on the screen is running. */
  disabled?: boolean;
  onJoin: () => void;
  onDecline: () => void;
}) {
  const held = disabled || busy != null;
  return (
    <section className="ui-invite-card" aria-label={company}>
      <p className="ui-invite-name">{company}</p>
      <p className="ui-invite-line">{line}</p>
      <div className="ui-invite-actions">
        <Button
          variant="secondary"
          busy={busy === "join"}
          disabled={held}
          aria-label={`הצטרפות ל${company}`}
          onClick={() => {
            if (!held) onJoin();
          }}
        >
          הצטרפות
        </Button>
        <TextLink
          chevron={false}
          busy={busy === "decline"}
          disabled={held}
          label={`דחייה של ${company}`}
          onClick={() => {
            if (!held) onDecline();
          }}
        >
          דחייה
        </TextLink>
      </div>
    </section>
  );
}
