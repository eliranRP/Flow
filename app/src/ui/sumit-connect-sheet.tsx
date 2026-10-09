import { useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { ConnectSheet } from "./connect-sheet";
import { ImportFromField } from "./import-from-field";
import { TextField } from "./text-field";

export function SumitConnectSheet({
  open,
  onOpenChange,
  title,
  returnFocusRef,
  noCompanyBody,
  authReconnect,
  companyId,
  setCompanyId,
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
  companyId: string;
  setCompanyId: (value: string) => void;
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
  // Empty fields are caught here, on reserved message lines, before they reach the server.
  const [missing, setMissing] = useState({ companyId: false, apiKey: false });
  const companyRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);
  // A closed sheet opens again without the last attempt's messages.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) setMissing({ companyId: false, apiKey: false });
  }
  return (
    <ConnectSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      returnFocusRef={returnFocusRef}
      noCompanyBody={noCompanyBody}
      authReconnect={authReconnect}
      fields={(
        <>
          <TextField
            ref={companyRef}
            label="מספר חברה"
            dir="ltr"
            numeric
            value={companyId}
            inputMode="numeric"
            readOnly={busy}
            error={missing.companyId ? "חסר מספר חברה." : undefined}
            reserveMessage
            onChange={(event) => { setMissing((m) => ({ ...m, companyId: false })); setCompanyId(event.target.value); }}
          />
          <TextField
            ref={keyRef}
            label="מפתח API"
            type="password"
            dir="ltr"
            value={apiKey}
            autoComplete="off"
            readOnly={busy}
            error={missing.apiKey ? "חסר מפתח." : undefined}
            reserveMessage
            onChange={(event) => { setMissing((m) => ({ ...m, apiKey: false })); setApiKey(event.target.value); }}
          />
          {setImportFrom == null ? null : <ImportFromField value={importFrom} onChange={setImportFrom} disabled={busy} />}
        </>
      )}
      submitLabel={submitLabel}
      busy={busy}
      disabled={disabled}
      onSubmit={() => {
        if (busy) return;
        const next = { companyId: companyId.trim() === "", apiKey: apiKey.trim() === "" };
        if (next.companyId || next.apiKey) {
          // Commit aria-invalid and the messages first, so focus announces them.
          flushSync(() => { setMissing(next); });
          (next.companyId ? companyRef : keyRef).current?.focus();
          return;
        }
        onSubmit();
      }}
      onDisconnect={onDisconnect}
      disconnectRef={disconnectRef}
    />
  );
}
