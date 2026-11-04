import { Fragment } from "react";
import { LEGAL_LINKS } from "../legal-copy";
import { Button } from "../ui/button";

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
