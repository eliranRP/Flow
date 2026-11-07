import { useState, type ReactNode } from "react";
import type { Decorator } from "@storybook/react-vite";
import { useQueryClient } from "@tanstack/react-query";
import type { TxnMeta } from "../txn-meta";
import { lineMetaQueryKey } from "../use-books";
import { SheetSurface } from "./sheet";

export const longHebrew =
  "שיפוץ דירת הגג ברחוב הרצל שתים עשרה, כולל הריסה, חשמל, אינסטלציה, ריצוף וצבע";

/** ₪123,456,789, stored as agorot. */
export const largeAgorot = 12_345_678_900n;

export const padded: Decorator = (Story) => (
  <div className="flex w-full min-w-0 flex-col items-stretch gap-4 p-4">
    <Story />
  </div>
);

/**
 * Draws the story on a still sheet at the bottom of the frame: grab handle, head and body
 * padding, as in the app. `parameters.sheetTitle` names it.
 */
export const inSheet: Decorator = (Story, context) => {
  const title: unknown = context.parameters.sheetTitle;
  return (
    <div className="flex min-h-dvh flex-col justify-end">
      <SheetSurface title={typeof title === "string" ? title : ""}>
        <Story />
      </SheetSurface>
    </div>
  );
};

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

/**
 * FLOW-1097: at 320 every דורש טיפול card with a short title draws it and its tag on one line, nothing cut, and
 * its link keeps the full title as its name. Returns each card's "<short> · <tag>", for the story to compare.
 */
export function oneLineAttention(canvasElement: HTMLElement): string[] {
  const cards = [...canvasElement.querySelectorAll<HTMLElement>(".ui-attn-link-short")];
  return cards.map((link) => {
    const title = link.querySelector<HTMLElement>(".ui-attn-short-title");
    const tag = link.querySelector<HTMLElement>(".ui-attn-tag");
    const full = link.querySelector<HTMLElement>(".ui-attn-text");
    if (title == null || tag == null || full == null) throw new Error("A short card without its parts");
    if (getComputedStyle(full).display !== "none") throw new Error("The full title still shows under 360px");
    const lineHeight = Number.parseFloat(getComputedStyle(title).lineHeight);
    for (const part of [title, tag]) {
      const box = part.getBoundingClientRect();
      if (part.scrollWidth > part.clientWidth + 1) throw new Error(`Cut: ${part.dataset.text ?? ""} ${String(part.scrollWidth)}/${String(part.clientWidth)}`);
      if (box.width === 0 || (part === title && box.height > lineHeight * 1.5)) throw new Error(`Not one line: ${part.dataset.text ?? ""}`);
    }
    const middle = (box: DOMRect) => box.top + box.height / 2;
    if (Math.abs(middle(tag.getBoundingClientRect()) - middle(title.getBoundingClientRect())) > lineHeight / 2) throw new Error("The tag is on its own line");
    if (link.getAttribute("aria-label") !== full.textContent) throw new Error("The link lost its full title");
    return `${title.dataset.text ?? ""} · ${tag.dataset.text ?? ""}`;
  });
}
