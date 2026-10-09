import { useId, type ReactNode, type RefObject, type SubmitEvent } from "react";
import { Button } from "./button";
import { List, ListRow } from "./list-row";
import { LogoutIcon } from "./icons";
import { Sheet } from "./sheet";

export function ConnectSheet({
  open,
  onOpenChange,
  title,
  hint,
  returnFocusRef,
  noCompanyBody,
  authReconnect,
  authReconnectLead,
  fields,
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
  hint?: ReactNode;
  returnFocusRef?: RefObject<HTMLElement | null>;
  noCompanyBody?: ReactNode;
  authReconnect?: boolean;
  authReconnectLead?: ReactNode;
  fields: ReactNode;
  submitLabel: string;
  busy: boolean;
  disabled?: boolean;
  onSubmit: () => void;
  onDisconnect?: () => void;
  disconnectRef?: RefObject<HTMLButtonElement | null>;
}) {
  const formId = useId();
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      returnFocusRef={returnFocusRef}
      // FLOW-350: the main action is pinned in the sheet's foot, so a longer form (SUMIT with
      // מתאריך at 320) never pushes it below the fold, and it doesn't move when the form grows.
      action={noCompanyBody == null ? <Button type="submit" form={formId} full busy={busy} disabled={disabled}>{submitLabel}</Button> : undefined}
    >
      {noCompanyBody ?? (
        <div className="ui-stack">
          {hint != null ? <p className="t-hint">{hint}</p> : null}
          {authReconnect ? authReconnectLead ?? <p>המזהה או המפתח לא התקבלו</p> : null}
          <form
            id={formId}
            className="ui-stack"
            onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            {fields}
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
