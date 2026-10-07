import { useState, type ReactNode } from "react";
import type { Decorator } from "@storybook/react";
import { useQueryClient } from "@tanstack/react-query";
import type { TxnMeta } from "../txn-meta";
import { lineMetaQueryKey } from "../use-books";

export const longHebrew =
  "שיפוץ דירת הגג ברחוב הרצל שתים עשרה, כולל הריסה, חשמל, אינסטלציה, ריצוף וצבע";

/** ₪123,456,789, stored as agorot. */
export const largeAgorot = 12_345_678_900n;

export const padded: Decorator = (Story) => (
  <div className="flex w-full min-w-0 flex-col items-stretch gap-4 p-4">
    <Story />
  </div>
);

export function Stack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3">{children}</div>;
}

/**
 * FLOW-304. Puts bank details in the story's query cache under the key the real
 * read uses, so a sample screen shows them with no network. Render it first.
 */
export function SeedLineMeta({ meta }: { meta: TxnMeta[] }) {
  const client = useQueryClient();
  useState(() => {
    for (const row of meta) client.setQueryData(lineMetaQueryKey("off", row.transaction_id), row);
    return true;
  });
  return null;
}


/** Invented bank details for stories: no real accounts, cards, or names. */
export function storyMeta(transactionId: string, fields: Partial<Omit<TxnMeta, "transaction_id">>): TxnMeta {
  return {
    transaction_id: transactionId,
    method: null,
    card_last4: null,
    memo: null,
    account: null,
    counterparty: null,
    bank_description: null,
    ...fields,
  };
}
