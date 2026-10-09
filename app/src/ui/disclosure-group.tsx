import { useId, useState, type ReactNode } from "react";
import { ChevronDownIcon } from "./icons";
import { TextLink } from "./text-link";

/**
 * A quiet "label (N)" link that shows or hides a group of rows under it, collapsed by
 * default: the loans list's "נסגרו (N)" (FLOW-106), lifted from Categories' "מוסתרות"
 * link. The rows are not drawn while the group is closed.
 */
export function DisclosureGroup({
  label,
  count,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  children,
}: {
  label: string;
  count: number;
  defaultOpen?: boolean;
  /** Controlled open state, for stories and tests. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const id = useId();
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const open = controlledOpen ?? ownOpen;
  if (count <= 0) return null;
  return (
    <div className="ui-disclosure">
      <div className="ui-disclosure-head">
        <TextLink
          tone="quiet"
          chevron={false}
          wrap
          expanded={open}
          controls={id}
          trailing={<ChevronDownIcon size={16} />}
          onClick={() => {
            const next = !open;
            setOwnOpen(next);
            onOpenChange?.(next);
          }}
        >
          {label} (<bdi className="ui-num">{String(count)}</bdi>)
        </TextLink>
      </div>
      <div id={id} hidden={!open}>
        {open ? children : null}
      </div>
    </div>
  );
}
