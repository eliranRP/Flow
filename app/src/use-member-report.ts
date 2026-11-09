import type { FetchedTreasuryYield, MemberReportConfig, MemberReportLoan, MemberReportProperty } from "@flow/shared";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { getSupabase } from "./lib/supabase";
import { useHomePreview } from "./preview";
import { useToast } from "./ui/toast";
import { assertNoError, useWrite } from "./use-write";
import { waitForAccessToken } from "./wait-for-session";

/**
 * FLOW-1118 (decision 0263): the member share report's read (get_member_report) and its write
 * (set_member_report). The share itself is computed in @flow/shared's computeMemberShare.
 */

/** What get_member_report returns: the setting (null before the first save) and each property's inputs. */
export type MemberReportRead = {
  config: MemberReportConfig | null;
  properties: MemberReportProperty[];
  /** FLOW-1124: the company's open loans, for the members' own loans. */
  loans: MemberReportLoan[];
  /** FLOW-1119: the Treasury's fetched yields around the quote dates; a typed yield wins over them. */
  treasuryYields: FetchedTreasuryYield[];
  /** FLOW-1121: when the yields were last fetched from the Treasury, and last asked for; null before either. */
  treasuryFetchedAt?: string | null;
  treasuryRequestedAt?: string | null;
  canEdit: boolean;
};

/** A part of the setting set_member_report replaces; null clears it. */
export type MemberReportPatch = { [K in keyof MemberReportConfig]?: MemberReportConfig[K] | null };

export const MEMBER_REPORT_KEY = "member-report";

const MINOR = z.union([z.number(), z.string()]).transform((v) => BigInt(v));

const readSchema = z.object({
  config: z.record(z.string(), z.unknown()).nullable(),
  properties: z.array(z.object({
    project_id: z.string(),
    name: z.string(),
    currency: z.string(),
    value_minor: MINOR.nullable(),
    value_date: z.string().nullable(),
    selling_cost_bp: z.number().int().nullable(),
    loan_balance_minor: MINOR,
    loans_other_currency: z.boolean(),
    // FLOW-1124: the all-in as the investment page counts it (absent before it deploys).
    all_in_minor: MINOR.nullable().optional(),
    purchase_minor: MINOR.nullable().optional(),
    rehab_minor: MINOR.nullable().optional(),
    holding_minor: MINOR.nullable().optional(),
  })),
  loans: z.array(z.object({
    loan_id: z.string(),
    name: z.string(),
    kind: z.string(),
    project_id: z.string().nullable(),
    currency: z.string(),
    balance_minor: MINOR,
  })).default([]),
  treasury_yields: z.array(z.object({
    on_date: z.string(),
    y5_ppm: z.number().int().nullable(),
    y10_ppm: z.number().int().nullable(),
  })).default([]),
  // FLOW-1121: when the Treasury's yields were last fetched, and last asked for (#1079; absent before it deploys).
  treasury_fetched_at: z.string().nullable().optional().default(null),
  treasury_requested_at: z.string().nullable().optional().default(null),
  can_edit: z.boolean(),
});

/** The RPC's answer as the screen reads it. */
export function parseMemberReport(data: unknown): MemberReportRead {
  const parsed = readSchema.parse(data);
  return {
    config: parsed.config,
    properties: parsed.properties,
    loans: parsed.loans,
    treasuryYields: parsed.treasury_yields,
    treasuryFetchedAt: parsed.treasury_fetched_at,
    treasuryRequestedAt: parsed.treasury_requested_at,
    canEdit: parsed.can_edit,
  };
}

/** refresh_treasury_yields' answer (#1079): asked now, or not, and why. */
export type RefreshAnswer = { requested: true } | { requested: false; reason: "recent" | "unavailable" };

const refreshSchema = z.union([
  z.object({ requested: z.literal(true) }).loose(),
  z.object({ requested: z.literal(false), reason: z.enum(["recent", "unavailable"]) }).loose(),
]);

/** FLOW-1121: asks the server to fetch the Treasury's yields now (the owner's רענון). */
export async function requestTreasuryRefresh(): Promise<RefreshAnswer> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  // The RPC ships with #1079; until the types know it, it is called by name.
  const call = supabase.rpc.bind(supabase) as unknown as (fn: string) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await call("refresh_treasury_yields");
  if (error) throw new Error(error.message);
  const parsed = refreshSchema.parse(data);
  return parsed.requested ? { requested: true } : { requested: false, reason: parsed.reason };
}

export function useMemberReport(enabled = true): UseQueryResult<MemberReportRead> {
  const preview = useHomePreview();
  return useQuery({
    queryKey: [MEMBER_REPORT_KEY, preview],
    enabled: enabled && preview === "off",
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("get_member_report");
      if (error) throw error;
      return parseMemberReport(data);
    },
  });
}

/** After a refresh is asked for, the report is read again at these delays: the fetch runs on the server. */
const REFRESH_READS_MS = [20_000, 60_000] as const;

/**
 * FLOW-1121: the owner's רענון of the Treasury yields. A toast says what happened; when the fetch was asked for,
 * the report is read again after about 20 s and 60 s. `busy` while the request is out. `sample` answers in
 * place of the server (stories).
 */
export function useRefreshTreasury(sample?: () => Promise<RefreshAnswer>): { refresh: () => Promise<void>; busy: boolean } {
  const client = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const timers = useRef<number[]>([]);
  useEffect(() => () => { for (const timer of timers.current) window.clearTimeout(timer); }, []);
  const refresh = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const answer = await (sample ?? requestTreasuryRefresh)();
      if (answer.requested) {
        toast.show({ message: "מבקשים את התשואות מהאוצר…" });
        for (const ms of REFRESH_READS_MS) {
          timers.current.push(window.setTimeout(() => { void client.invalidateQueries({ queryKey: [MEMBER_REPORT_KEY] }); }, ms));
        }
      } else {
        toast.show({ message: answer.reason === "recent" ? "כבר התבקש לפני רגע" : "לא ניתן לרענן כרגע" });
      }
    } catch {
      toast.show({ message: "לא ניתן לרענן כרגע" });
    } finally {
      setBusy(false);
    }
  }, [busy, client, sample, toast]);
  return { refresh, busy };
}

/**
 * FLOW-1121: a property's selling cost from the report, through the same write the investment page makes
 * (set_project_investment's selling_cost_bp; null is the default 8%), for one property or several. Reads the
 * report and the project's own reads (its page and returns sit under "project") again.
 */
export function useSellingCostWrite() {
  return useWrite<{ projectIds: readonly string[]; bp: number | null }>({
    failure: (error) => ((error as { code?: string }).code === "42501"
      ? { message: "רק בעלי החברה יכולים לשנות את עלויות המכירה.", retry: false }
      : "לא הצלחנו לשמור את עלויות המכירה."),
    keys: [MEMBER_REPORT_KEY, "project"],
    run: async ({ projectIds, bp }) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      for (const id of projectIds) {
        assertNoError(await supabase.rpc("set_project_investment", { p_project_id: id, p_patch: { selling_cost_bp: bp } }));
      }
    },
  });
}

/** A patch applied to a setting the way set_member_report merges it: a part named replaces it, null clears it. */
export function applyPatch(config: MemberReportConfig | null, patch: MemberReportPatch): MemberReportConfig {
  const merged: Record<string, unknown> = { ...config, ...patch };
  return Object.fromEntries(Object.entries(merged).filter(([, value]) => value != null));
}

/**
 * Saves a patch, then reads the report again. FLOW-1128: the tap shows at once (the read takes a second or two,
 * since each property's all-in is worked out); a failure puts the setting back and says so.
 */
export function useMemberReportWrite() {
  const client = useQueryClient();
  return useWrite<MemberReportPatch>({
    optimistic: (patch) => client.getQueriesData<MemberReportRead>({ queryKey: [MEMBER_REPORT_KEY] })
      .filter(([, data]) => data != null)
      .map(([key]) => ({
        key,
        update: (old: unknown) => {
          const read = old as MemberReportRead | undefined;
          return read == null ? read : { ...read, config: applyPatch(read.config, patch) };
        },
      })),
    failure: (error) => ((error as { code?: string }).code === "42501"
      ? { message: "רק בעלי החברה יכולים לשנות את הדוח.", retry: false }
      : error.message.includes("100%") ? { message: "הבעלות צריכה להסתכם ב־100%.", retry: false } : "לא הצלחנו לשמור."),
    keys: [MEMBER_REPORT_KEY],
    run: async (patch) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("set_member_report", { p_patch: patch as never }));
    },
  });
}
