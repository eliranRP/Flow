import { formatAmountText } from "@flow/shared";
import { Fragment, type ReactNode } from "react";
import { amountOf, percentMinorOf, percentOf, type PartDraft } from "../line-split";
import { CheckIcon } from "../ui/icons";

/**
 * FLOW-954 (board LedgerSplitContra, owner 2026-10-22). A credit part, זיכוי, in the split editor: a
 * part that nets against the line (the server's gross_up part, decision 0207). The wording replaces
 * the old "גרוס-אפ" everywhere; the behaviour is unchanged.
 */

/** A part's money in minor units: its amount, or its percent's cents (the server's once previewed). */
export function partMinor(part: PartDraft, lineMinor: bigint, cents: bigint | undefined): bigint | null {
  if (part.unit === "amount") return amountOf(part.value);
  if (cents != null) return cents;
  const percent = percentOf(part.value);
  return percent == null ? null : percentMinorOf(percent, lineMinor);
}

/** The switch in a part's head: "סמנו כזיכוי", and once on, the filled "✓ זיכוי" chip. */
export function CreditToggle({ on, name, onToggle }: { on: boolean; name: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="ui-lsplit-credit ui-hit"
      role="switch"
      aria-checked={on}
      aria-label={`זיכוי, ${name}`}
      onClick={onToggle}
    >
      {on ? (
        <span className="ui-lsplit-credit-chip">
          <CheckIcon size={14} />
          זיכוי
        </span>
      ) : "סמנו כזיכוי"}
    </button>
  );
}

/**
 * What a category nets to when it has both a normal and a credit part: the credits less the normal
 * parts, so a positive figure is a credit. Null when the category has only one kind, or a value is
 * still missing.
 */
export function categoryNet(parts: readonly PartDraft[], categoryId: string, minorOf: (part: PartDraft) => bigint | null): bigint | null {
  const mine = parts.filter((part) => part.categoryId === categoryId && categoryId !== "");
  if (!mine.some((part) => part.grossUp === true) || !mine.some((part) => part.grossUp !== true)) return null;
  let net = 0n;
  for (const part of mine) {
    const minor = minorOf(part);
    if (minor == null) return null;
    net += part.grossUp === true ? minor : -minor;
  }
  return net;
}

/** The credit part's note: it comes off the line, and what its category nets to ("+$601.29 זיכוי"). */
export function creditNote(net: bigint | null, categoryName: string, currency: string): ReactNode {
  if (net == null) return "יורד מהסכום";
  const figure = net === 0n
    ? formatAmountText(0n, currency, { detail: true })
    : net > 0n ? `+${formatAmountText(net, currency, { detail: true })}` : `−${formatAmountText(-net, currency, { detail: true })}`;
  return (
    <>
      {`יורד מהסכום · נטו ב${categoryName}: `}
      <bdi className="ui-num ui-lsplit-net" dir="ltr">{figure}</bdi>
      {net > 0n ? " זיכוי" : null}
    </>
  );
}

/**
 * The header's check once a split with a credit part adds up: the parts signed (a credit with a
 * minus), plus what stays on the line, equal the line ("✓ תואם לשורה · a − b + c = line").
 */
export function SignedCheck({ terms, rest, lineMinor, currency }: { terms: ReadonlyArray<{ minor: bigint; credit: boolean }>; rest: bigint; lineMinor: bigint; currency: string }) {
  const money = (minor: bigint) => formatAmountText(minor, currency, { detail: true });
  const all = rest > 0n ? [...terms, { minor: rest, credit: false }] : terms;
  // Each amount is its own unbreakable number; the sum wraps only between its terms.
  return (
    <span className="ui-lsplit-check">
      <CheckIcon size={16} />
      <span>
        {"תואם לשורה · "}
        <bdi dir="ltr">
          {all.map((term, index) => (
            <Fragment key={index}>
              {index === 0 ? (term.credit ? "−" : "") : ` ${term.credit ? "−" : "+"} `}
              <span className="ui-num">{money(term.minor)}</span>
            </Fragment>
          ))}
          {" = "}
          <span className="ui-num">{money(lineMinor)}</span>
        </bdi>
      </span>
    </span>
  );
}
