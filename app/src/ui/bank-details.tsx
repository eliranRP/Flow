import { type MethodIconKind } from "../txn-meta";
import { CardIcon, DocumentIcon, TransferIcon } from "./icons";

/** The payment-method icon. Decorative: the label next to it carries the meaning. */
export function MethodIcon({ kind, size = 16 }: { kind: MethodIconKind; size?: number }) {
  return (
    <span className="ui-method-icon" aria-hidden="true">
      {kind === "card" ? <CardIcon size={size} /> : kind === "transfer" ? <TransferIcon size={size} /> : <DocumentIcon size={size} stroke={1.9} />}
    </span>
  );
}
