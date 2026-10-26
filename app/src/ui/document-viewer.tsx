// FLOW-965: a photographed invoice opens full screen on the transaction page ("הקישו להגדלה"), instead
// of a new tab. The close button takes the focus, Escape closes, and the focus goes back to the card.
// A PDF still opens in its own tab, as the card says ("הקישו לפתיחה").
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DocumentCard } from "./document-card";
import { CloseIcon } from "./icons";
import "./css/59-document-viewer.css";

export function PhotoDocumentCard({ href, title, note }: { href: string; title: string; note: string }) {
  const [open, setOpen] = useState(false);
  const cardRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <DocumentCard as="button" buttonRef={cardRef} href={href} title={title} note={note} onOpen={() => { setOpen(true); }} />
      {open ? (
        <DocumentViewer
          src={href}
          title={title}
          onClose={() => {
            setOpen(false);
            cardRef.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}

function DocumentViewer({ src, title, onClose }: { src: string; title: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); };
  }, [onClose]);
  return createPortal(
    <div className="ui-doc-viewer" role="dialog" aria-modal="true" aria-label={title}>
      <button ref={closeRef} type="button" className="ui-doc-viewer-close m-press" aria-label="סגירה" onClick={onClose}>
        <CloseIcon size={24} />
      </button>
      <img className="ui-doc-viewer-img" src={src} alt={title} />
    </div>,
    document.body,
  );
}
