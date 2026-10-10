import type { Ref } from "react";
import { ChevronDownIcon } from "./icons";

/**
 * FLOW-601 (mockup a-3). The company's name at the start of Home's band row. It ends in the
 * 16px ▼ every band label that opens a sheet uses (FLOW-335), and opens the חברה sheet.
 */
export function BandCompany({
  name,
  onOpen,
  buttonRef,
}: {
  name: string;
  onOpen: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className="ui-band-company"
      aria-haspopup="dialog"
      aria-label={`חברה: ${name}`}
      onClick={onOpen}
    >
      <span className="ui-band-company-name" data-clip-ok="">{name}</span>
      <ChevronDownIcon size={16} />
    </button>
  );
}
