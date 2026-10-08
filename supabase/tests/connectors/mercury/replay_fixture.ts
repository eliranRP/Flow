import page1 from "./fixtures/transactions-desc-page1.json" with { type: "json" };
import page2 from "./fixtures/transactions-desc-page2.json" with { type: "json" };
import accountsFile from "./fixtures/accounts.json" with { type: "json" };
import creditFile from "./fixtures/credit.json" with { type: "json" };
import treasuryFile from "./fixtures/treasury.json" with { type: "json" };
import type { NormalizeContext } from "../../../functions/_shared/connectors/types.ts";
import { fixtureContext as contextFor, snapshotOf } from "./snapshot.ts";

export { snapshotOf };

export const postedLines = [...page1.transactions, ...page2.transactions];

const fixtureAccountIds = () => [
  ...accountsFile.accounts.map((account) => account.id),
  ...creditFile.accounts.map((account) => account.id),
  ...treasuryFile.accounts.map((account) => account.id),
];

export function fixtureContext(extra: Partial<NormalizeContext> = {}): NormalizeContext {
  return contextFor(extra, fixtureAccountIds());
}

export function postedSnapshot() {
  return snapshotOf(postedLines, fixtureAccountIds());
}
