import type { LegalKind } from "../legal-copy";
import { Button } from "../ui/button";

/**
 * The links every legal footer shows, in this order (sign-in and settings). They live here, not in
 * legal-copy.ts, so sign-in's entry chunk never pulls in the legal texts (decision 0252).
 */
export const LEGAL_LINKS: readonly { to: `/${LegalKind}`; label: string }[] = [
  { to: "/terms", label: "תנאי שימוש" },
  { to: "/privacy", label: "מדיניות פרטיות" },
  { to: "/cookies", label: "עוגיות ואחסון" },
  { to: "/accessibility", label: "הצהרת נגישות" },
];

/**
 * Decision 0252: the four legal pages, as hint links (sign-in and settings). FLOW-519: a 2×2 grid
 * of 44px targets with no separators, so no "·" is left at a line end at 320.
 */
export function LegalLinks({ className }: { className: string }) {
  return (
    <nav aria-label="מידע משפטי" className={className}>
      <ul className="ui-legal-links">
        {LEGAL_LINKS.map((link) => (
          <li key={link.to}>
            <Button variant="link" to={link.to} className="ui-btn-link-hint">
              {link.label}
            </Button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
