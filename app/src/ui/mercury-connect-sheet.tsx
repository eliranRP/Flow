import { useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { ConnectSheet } from "./connect-sheet";
import { ImportFromField } from "./import-from-field";
import { TextField } from "./text-field";

export function MercuryConnectSheet({
  open,
  onOpenChange,
  title,
  returnFocusRef,
  noCompanyBody,
  authReconnect,
  apiKey,
  setApiKey,
  submitLabel,
  busy,
  disabled,
  onSubmit,
  onDisconnect,
  disconnectRef,
  importFrom = null,
  setImportFrom,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
  noCompanyBody?: React.ReactNode;
  authReconnect?: boolean;
  apiKey: string;
  setApiKey: (value: string) => void;
  submitLabel: string;
  busy: boolean;
  disabled?: boolean;
  onSubmit: () => void;
  onDisconnect?: () => void;
  disconnectRef?: RefObject<HTMLButtonElement | null>;
  /** "ייבוא מ" (FLOW-505): null is מההתחלה. Shown only with `setImportFrom`. */
  importFrom?: string | null;
  setImportFrom?: (value: string | null) => void;
}) {
  // An empty key is caught here, on a reserved message line, before it reaches the server.
  const [missing, setMissing] = useState(false);
  const keyRef = useRef<HTMLInputElement>(null);
  // A closed sheet opens again without the last attempt's messages.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) setMissing(false);
  }
  return (
    <ConnectSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      returnFocusRef={returnFocusRef}
      noCompanyBody={noCompanyBody}
      authReconnect={authReconnect}
      authReconnectLead={<p>המפתח לא התקבל</p>}
      fields={(
        <>
          <TextField
            ref={keyRef}
            label="מפתח API"
            type="password"
            dir="ltr"
            value={apiKey}
            autoComplete="off"
            readOnly={busy}
            error={missing ? "חסר מפתח." : undefined}
            reserveMessage
            onChange={(event) => { setMissing(false); setApiKey(event.target.value); }}
          />
          {setImportFrom == null ? null : <ImportFromField value={importFrom} onChange={setImportFrom} disabled={busy} />}
        </>
      )}
      submitLabel={submitLabel}
      busy={busy}
      disabled={disabled}
      onSubmit={() => {
        if (busy) return;
        if (apiKey.trim() === "") {
          // Commit aria-invalid and the message first, so focus announces them.
          flushSync(() => { setMissing(true); });
          keyRef.current?.focus();
          return;
        }
        onSubmit();
      }}
      onDisconnect={onDisconnect}
      disconnectRef={disconnectRef}
    />
  );
}
