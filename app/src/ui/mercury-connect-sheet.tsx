import { useRef, useState, type RefObject } from "react";
import { ConnectSheet } from "./connect-sheet";
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
      )}
      submitLabel={submitLabel}
      busy={busy}
      disabled={disabled}
      onSubmit={() => {
        if (busy) return;
        if (apiKey.trim() === "") {
          setMissing(true);
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
