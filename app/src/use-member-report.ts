import type { FetchedTreasuryYield, MemberReportConfig, MemberReportProperty } from "@flow/shared";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { z } from "zod";
import { getSupabase } from "./lib/supabase";
import { useHomePreview } from "./preview";
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
  /** FLOW-1119: the Treasury's fetched yields around the quote dates; a typed yield wins over them. */
  treasuryYields: FetchedTreasuryYield[];
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
  })),
  treasury_yields: z.array(z.object({
    on_date: z.string(),
    y5_ppm: z.number().int().nullable(),
    y10_ppm: z.number().int().nullable(),
  })).default([]),
  can_edit: z.boolean(),
});

/** The RPC's answer as the screen reads it. */
export function parseMemberReport(data: unknown): MemberReportRead {
  const parsed = readSchema.parse(data);
  return {
    config: parsed.config,
    properties: parsed.properties,
    treasuryYields: parsed.treasury_yields,
    canEdit: parsed.can_edit,
  };
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

/** Saves a patch, then reads the report again. */
export function useMemberReportWrite() {
  return useWrite<MemberReportPatch>({
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
