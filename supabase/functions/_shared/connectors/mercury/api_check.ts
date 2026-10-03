import type { MercuryCreditResponse } from "./credit.ts";
import type { paths } from "./api.d.ts";

type AccountsGet = paths["/accounts"]["get"];
type TransactionsGet = paths["/transactions"]["get"];
type TransactionGet = paths["/transaction/{transactionId}"]["get"];

const credit: MercuryCreditResponse = { accounts: [{ id: "card_1", status: "active" }] };

export type MercuryApiChecked = AccountsGet | TransactionsGet | TransactionGet | typeof credit;
