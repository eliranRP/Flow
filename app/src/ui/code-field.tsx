import type { RefObject } from "react";
import { CopyIcon } from "./icons";
import { IconButton } from "./icon-button";

/** Which value the copy control belongs to. The component used to share this name. */
export type CopyTarget = "url" | "secret" | "command";

export function CodeField({
  label,
  labelId,
  fieldLabel,
  value,
  valueRef,
  failed,
  copyLabel,
  onCopy,
}: {
  label?: string;
  labelId?: string;
  fieldLabel?: string;
  value: string;
  valueRef?: RefObject<HTMLInputElement | null>;
  failed: boolean;
  /** Accessible name. The icon stays the visible control. */
  copyLabel: string;
  onCopy: () => void;
}) {
  const named = label != null && labelId != null;
  const control = (
    <>
      {named ? <p className="ui-field-label" id={labelId}>{label}</p> : null}
      <div className="ui-code-field-box" data-copy={value === "" ? "off" : "on"}>
        <input
          ref={valueRef}
          className="ui-field-control ui-code-field-input"
          readOnly
          dir="ltr"
          value={value}
          aria-label={named ? undefined : fieldLabel}
          aria-labelledby={named ? labelId : undefined}
          autoComplete="off"
          spellCheck={false}
          data-vaul-no-drag=""
        />
        {value === "" ? null : (
          <IconButton label={copyLabel} className="ui-code-field-copy" onClick={onCopy}>
            <CopyIcon />
          </IconButton>
        )}
      </div>
      {failed ? <p className="t-hint" role="status">העתיקו ידנית</p> : null}
    </>
  );
  if (!named) return <div className="ui-code-field">{control}</div>;
  return (
    <div className="ui-code-field" role="group" aria-labelledby={labelId}>
      {control}
    </div>
  );
}
