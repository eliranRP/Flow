import type { ReactNode, RefObject, SubmitEvent } from "react";
import { Button } from "./button";
import { List, ListRow } from "./list-row";
import { LogoutIcon } from "./icons";
import { Sheet } from "./sheet";
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
  noCompanyBody?: ReactNode;
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
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} returnFocusRef={returnFocusRef}>
      {noCompanyBody ?? (
        <div className="ui-stack">
          {authReconnect ? <p>המזהה או המפתח לא התקבלו</p> : null}
          <form
            className="ui-stack"
            onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            <TextField label="מספר חברה" value={companyId} inputMode="numeric" onChange={(event) => { setCompanyId(event.target.value); }} />
            <TextField label="מפתח API" type="password" value={apiKey} autoComplete="off" onChange={(event) => { setApiKey(event.target.value); }} />
            <Button type="submit" busy={busy} disabled={disabled}>{submitLabel}</Button>
          </form>
          {authReconnect && onDisconnect ? (
            <List>
              <ListRow variant="danger" title="ניתוק" icon={<LogoutIcon />} buttonRef={disconnectRef} onClick={onDisconnect} />
            </List>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}
