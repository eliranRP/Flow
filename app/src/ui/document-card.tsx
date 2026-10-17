import { ChevronIcon } from "./icons";

/**
 * A document row: the thumbnail tile, the title, a muted note and a chevron. It opens the document in a new tab.
 * The invoice page and the transaction page share it (the board draws both the same).
 */
export function DocumentCard({ href, title, note }: { href: string; title: string; note: string }) {
  return (
    <a className="ui-inv-doc" href={href} target="_blank" rel="noopener noreferrer">
      <span className="ui-inv-thumb" aria-hidden="true"><span /><span /><span /></span>
      <span className="ui-inv-doc-copy">
        <span className="ui-inv-doc-title">{title}</span>
        <span className="ui-inv-doc-sub">{note}</span>
      </span>
      <span className="ui-inv-doc-chevron" aria-hidden="true"><ChevronIcon size={18} /></span>
    </a>
  );
}
