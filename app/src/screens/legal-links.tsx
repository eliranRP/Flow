import { Fragment } from "react";
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

/** Decision 0252: the four legal pages, as hint links with 44px targets (sign-in and settings). */
export function LegalLinks() {
  return (
    <>
      {LEGAL_LINKS.map((link, i) => (
        <Fragment key={link.to}>
          {i > 0 ? " · " : null}
          <Button variant="link" to={link.to} className="ui-btn-link-hint">
            {link.label}
          </Button>
        </Fragment>
      ))}
    </>
  );
}
