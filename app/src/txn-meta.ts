/** FLOW-304. How the money moved, from `get_line_meta`. */
export const TXN_METHODS = ["card", "ach", "wire", "check", "transfer", "other"] as const;
export type TxnMethod = (typeof TXN_METHODS)[number];

export type TxnMeta = {
  transaction_id: string;
  method: TxnMethod | null;
  card_last4: string | null;
  memo: string | null;
  account: string | null;
  counterparty: string | null;
  bank_description: string | null;
};

const BULLETS = "••";

/** Guard for the server mask: a run of 5 or more digits keeps only its last 4. */
export function maskLongDigits(text: string): string {
  return text.replace(/\d{5,}/g, (run) => `${BULLETS}${run.slice(-4)}`);
}

/** "Mercury Checking ••1234" → name and last 4. The last 4 never truncates, the name can. */
export function splitAccountLast4(account: string): { name: string; last4: string | null } {
  const match = /^(.*?)\s*••(\d{4})$/u.exec(account.trim());
  if (!match) return { name: account.trim(), last4: null };
  return { name: match[1] ?? "", last4: match[2] ?? null };
}

export type MethodIconKind = "card" | "transfer" | "check";

export type MethodLabel = {
  icon: MethodIconKind;
  /** The review card's few words: ••4242, ACH, העברה בנקאית. */
  short: string;
  /** The detail row title: כרטיס ••4242, העברת ACH. */
  detail: string;
  /** What a screen reader says for the short label. */
  spoken: string;
};

/** Null for `other`, null, or no meta: those show no method line. */
export function methodLabel(meta: Pick<TxnMeta, "method" | "card_last4"> | null | undefined): MethodLabel | null {
  if (meta == null) return null;
  const last4 = meta.card_last4 != null && /^\d{4}$/.test(meta.card_last4) ? meta.card_last4 : null;
  switch (meta.method) {
    case "card":
      return last4
        ? { icon: "card", short: `${BULLETS}${last4}`, detail: `כרטיס ${BULLETS}${last4}`, spoken: `כרטיס שמסתיים ב־${last4}` }
        : { icon: "card", short: "כרטיס", detail: "כרטיס", spoken: "כרטיס" };
    case "ach":
      return { icon: "transfer", short: "ACH", detail: "העברת ACH", spoken: "העברת ACH" };
    case "wire":
      return { icon: "transfer", short: "העברה בנקאית", detail: "העברה בנקאית", spoken: "העברה בנקאית" };
    case "transfer":
      return { icon: "transfer", short: "העברה פנימית", detail: "העברה פנימית", spoken: "העברה פנימית" };
    case "check":
      return { icon: "check", short: "צ׳ק", detail: "צ׳ק", spoken: "צ׳ק" };
    default:
      return null;
  }
}

/** The counterparty row is hidden when it repeats the party shown above. */
export function sameParty(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false;
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}

/** True when the detail has at least one bank row to show. */
export function hasBankRows(meta: TxnMeta | null | undefined, party: string | null | undefined): boolean {
  if (meta == null) return false;
  return (
    methodLabel(meta) != null ||
    meta.account != null ||
    (meta.counterparty != null && !sameParty(meta.counterparty, party)) ||
    meta.memo != null ||
    meta.bank_description != null
  );
}
