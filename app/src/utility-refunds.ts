import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createContext, createElement, useContext, type ReactNode } from "react";
import type { z } from "zod";
import { getSupabase } from "./lib/supabase";
import { loadReadSchemas } from "./load-read-schemas";
import { useHomePreview } from "./preview";
import type { RpcClient } from "./recurring-actions";
import type { utilityIncomeSchema, utilityPayersSchema, utilityRefundsSchema } from "./utility-refund-schema";
import { assertNoError } from "./use-write";
import { waitForAccessToken } from "./wait-for-session";

/**
 * FLOW-1135 (decision 0265): the utility bills a property's tenant has not paid back. The match is the
 * server's (list_utility_refunds); the owner answers each suggestion and closes each bill not refunded.
 */
export type UtilityRefunds = z.output<typeof utilityRefundsSchema>;
export type UtilityBill = UtilityRefunds["bills"][number];
export type UtilityPayment = NonNullable<UtilityBill["payment"]>;
export type UtilityPayer = z.output<typeof utilityPayersSchema>[number];
export type Payer = UtilityPayer["payer"];
/** FLOW-1159: a bill and the money in around it (list_utility_income). */
export type UtilityIncome = z.output<typeof utilityIncomeSchema>;
export type UtilityIncomeBill = UtilityIncome["bill"];

export const UTILITY_REFUNDS_KEY = "utility-refunds";
export const UTILITY_PAYERS_KEY = "utility-payers";
export const UTILITY_INCOME_KEY = "utility-income";

/**
 * Where the utility reads and writes go: Flow's server, or, in a story, a stand-in that answers from sample data
 * (`stub`). Every read and write of these screens takes its client from here.
 */
type UtilityClient = { get: () => RpcClient | null; stub: boolean };

const UtilityClientContext = createContext<UtilityClient>({ get: getSupabase, stub: false });

/**
 * A story's client: the screens read and write through `client` instead of Flow's server. Invented data only.
 * @forTests
 */
export function UtilityClientProvider({ client, children }: { client: RpcClient; children: ReactNode }) {
  return createElement(UtilityClientContext.Provider, { value: { get: () => client, stub: true } }, children);
}

/** The client for a write: throws when there is none (no Supabase configured). */
export function useUtilityRpc(): () => RpcClient {
  const { get } = useContext(UtilityClientContext);
  return () => {
    const rpc = get();
    if (!rpc) throw new Error("supabase");
    return rpc;
  };
}

/** True inside a story's UtilityClientProvider: a sample page may read through it. */
export function useUtilityStub(): boolean {
  return useContext(UtilityClientContext).stub;
}

function useReadClient(): () => Promise<RpcClient> {
  const rpc = useUtilityRpc();
  return async () => {
    const supabase = rpc();
    await waitForAccessToken(supabase);
    return supabase;
  };
}

/**
 * The bills that ask for an answer, all properties or one (`projectId`). `all` reads every bill with its state
 * (matched ones too), for the payment picker to leave out a payment that is already another bill's refund.
 */
export function useUtilityRefundsQuery(projectId: string | null, active = true, all = false) {
  const preview = useHomePreview();
  const client = useReadClient();
  return useQuery({
    queryKey: [UTILITY_REFUNDS_KEY, preview, projectId ?? "", all ? "all" : "open"],
    enabled: active && preview === "off",
    queryFn: async (): Promise<UtilityRefunds> => {
      const supabase = await client();
      const { data, error } = await supabase.rpc("list_utility_refunds", {
        ...(projectId == null ? {} : { p_project_id: projectId }),
        ...(all ? { p_all: true } : {}),
      });
      if (error) throw error;
      return (await loadReadSchemas()).utilityRefundsSchema.parse(data);
    },
  });
}

/** A property's utilities: who pays each, its usual amount and its bills. */
export function useUtilityPayersQuery(projectId: string, active = true) {
  const preview = useHomePreview();
  const client = useReadClient();
  return useQuery({
    queryKey: [UTILITY_PAYERS_KEY, preview, projectId],
    enabled: active && preview === "off" && projectId !== "",
    queryFn: async (): Promise<UtilityPayer[]> => {
      const supabase = await client();
      const { data, error } = await supabase.rpc("list_utility_payers", { p_project_id: projectId });
      if (error) throw error;
      return (await loadReadSchemas()).utilityPayersSchema.parse(data);
    },
  });
}

/**
 * FLOW-1159: the money in on a bill's property within `months` months before and after it (the server clamps it to
 * 1..6), newest first, with the bill and its state.
 */
export function useUtilityIncomeQuery(billId: string, months = 2, active = true) {
  const preview = useHomePreview();
  const client = useReadClient();
  return useQuery({
    queryKey: [UTILITY_INCOME_KEY, preview, billId, months],
    // A wider window keeps the lines on screen until the new ones arrive.
    placeholderData: keepPreviousData,
    enabled: active && preview === "off" && billId !== "",
    queryFn: async (): Promise<UtilityIncome> => {
      const supabase = await client();
      const { data, error } = await supabase.rpc("list_utility_income", { p_bill_transaction_id: billId, p_months: months });
      if (error) throw error;
      return (await loadReadSchemas()).utilityIncomeSchema.parse(data);
    },
  });
}

/**
 * One answer on a bill: the payment is its refund, it is not, nothing to do, or null to take the answer back (ביטול).
 * `keepCategory` (with matched only) keeps a payment filed elsewhere as it is (להשאיר), or drops that keep (its ביטול).
 */
export async function answerUtilityRefund(rpc: RpcClient, billId: string, state: "matched" | "rejected" | "seen" | null, paymentId: string | null, keepCategory?: boolean): Promise<void> {
  assertNoError(await rpc.rpc("answer_utility_refund", {
    p_bill_transaction_id: billId,
    // null takes the answer back; the generated type shows the parameter as text only.
    p_state: state as string,
    ...(paymentId == null ? {} : { p_payment_transaction_id: paymentId }),
    ...(keepCategory == null ? {} : { p_keep_category: keepCategory }),
  }));
}

/** סימון הכל כנראה: every open bill of the property not refunded. Returns the bills it closed, for ביטול. */
export async function markUtilityRefundsSeen(rpc: RpcClient, projectId: string): Promise<string[]> {
  const { data, error } = await rpc.rpc("mark_utility_refunds_seen", { p_project_id: projectId });
  assertNoError({ error });
  const ids = (data as { bill_transaction_ids?: unknown } | null)?.bill_transaction_ids;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

export async function unmarkUtilityRefundsSeen(rpc: RpcClient, billIds: readonly string[]): Promise<void> {
  assertNoError(await rpc.rpc("unmark_utility_refunds_seen", { p_bill_transaction_ids: [...billIds] }));
}

/** The one-tap fix: the payment moves to the bill's category (or the bill's part is split off a rent payment). */
export async function refileUtilityRefund(rpc: RpcClient, billId: string, paymentId: string): Promise<void> {
  assertNoError(await rpc.rpc("refile_utility_refund", { p_bill_transaction_id: billId, p_payment_transaction_id: paymentId }));
}

/** The fix's ביטול. The server refuses it once the line changed since ("line changed since"). */
export async function undoUtilityRefile(rpc: RpcClient, billId: string, paymentId: string): Promise<void> {
  assertNoError(await rpc.rpc("undo_utility_refile", { p_bill_transaction_id: billId, p_payment_transaction_id: paymentId }));
}

/** A utility's key: one supplier's bills for one property and currency. */
export type UtilityKey = { projectId: string; supplierId: string; currency: string };

/** What was set before a payer write, for its ביטול: null when the utility had no row (the tenant, by default). */
export type PayerPrior = { payer: Payer; added: boolean } | null;

/** Who pays a utility; null removes the owner's row. Returns what was set before. */
export async function setUtilityPayer(rpc: RpcClient, key: UtilityKey, payer: Payer | null, added = false): Promise<PayerPrior> {
  const { data, error } = await rpc.rpc("set_utility_payer", {
    p_project_id: key.projectId,
    p_supplier_id: key.supplierId,
    p_currency: key.currency,
    // null removes the row; the generated type shows the parameter as text only.
    p_payer: payer as string,
    p_added: added,
  });
  assertNoError({ error });
  const prior = (data as { prior?: { payer?: unknown; added?: unknown } | null } | null)?.prior;
  if (prior == null || (prior.payer !== "tenant" && prior.payer !== "company")) return null;
  return { payer: prior.payer, added: prior.added === true };
}

/** Puts a payer write back: the prior row, or no row. */
export function restoreUtilityPayer(rpc: RpcClient, key: UtilityKey, prior: PayerPrior): Promise<PayerPrior> {
  return setUtilityPayer(rpc, key, prior?.payer ?? null, prior?.added ?? false);
}
