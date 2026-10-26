import type { RefObject } from "react";
import { ChevronIcon } from "./icons";

/**
 * A document row: the thumbnail tile, the title, a muted note and a chevron. It opens the document in a new tab.
 * The invoice page and the transaction page share it (the board draws both the same). FLOW-965: as a button
 * (`as="button"`) the same row opens the document on the page instead (a photo, full screen).
 */
export function DocumentCard({
  href,
  title,
  note,
  as = "link",
  onOpen,
  buttonRef,
}: {
  href: string;
  title: string;
  note: string;
  as?: "link" | "button";
  onOpen?: () => void;
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const body = (
    <>
      <span className="ui-inv-thumb" aria-hidden="true"><span /><span /><span /></span>
      <span className="ui-inv-doc-copy">
        <span className="ui-inv-doc-title">{title}</span>
        <span className="ui-inv-doc-sub">{note}</span>
      </span>
      <span className="ui-inv-doc-chevron" aria-hidden="true"><ChevronIcon size={18} /></span>
    </>
  );
  if (as === "button") {
    return (
      <button ref={buttonRef} type="button" className="ui-inv-doc ui-inv-doc-button" onClick={onOpen}>
        {body}
      </button>
    );
  }
  return (
    <a className="ui-inv-doc" href={href} target="_blank" rel="noopener noreferrer">
      {body}
    </a>
  );
}
