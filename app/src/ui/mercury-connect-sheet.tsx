import type { RefObject } from "react";
import { MERCURY_CONNECT_HINT } from "../mercury-copy";
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
  return (
    <ConnectSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      hint={authReconnect ? undefined : MERCURY_CONNECT_HINT}
      returnFocusRef={returnFocusRef}
      noCompanyBody={noCompanyBody}
      authReconnect={authReconnect}
      authReconnectLead={<p>המפתח לא התקבל</p>}
      fields={(
        <TextField label="מפתח API" type="password" value={apiKey} autoComplete="off" onChange={(event) => { setApiKey(event.target.value); }} />
      )}
      submitLabel={submitLabel}
      busy={busy}
      disabled={disabled}
      onSubmit={onSubmit}
      onDisconnect={onDisconnect}
      disconnectRef={disconnectRef}
    />
  );
}
