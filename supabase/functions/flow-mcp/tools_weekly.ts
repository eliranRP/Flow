// MCP tools: the weekly summary (FLOW-517, decisions 0095 and 0211), what the sheet the Sunday push
// opens over Home shows. One read, get_weekly_summary, over the weekly_summary RPC.
import { fail, isCalendarDate, ok, READ_REFUSED, type ToolResult, type ToolRpc } from "./tools_args.ts";

/** The Sunday (YYYY-MM-DD, Israel time) of the week that ended before `now`'s week began. */
export function lastWeekStart(now: Date): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const day = new Date(`${today}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - day.getUTCDay() - 7);
  return day.toISOString().slice(0, 10);
}

/** week_start is a Sunday (YYYY-MM-DD); left out, the week that just ended. */
export async function weeklySummaryTool(args: Record<string, unknown>, rpc: ToolRpc, now = new Date()): Promise<ToolResult> {
  const asked = args.week_start;
  if (asked != null && (typeof asked !== "string" || !isCalendarDate(asked) || new Date(`${asked}T00:00:00Z`).getUTCDay() !== 0)) {
    return fail("validation", "validation");
  }
  const week = typeof asked === "string" ? asked : lastWeekStart(now);
  const result = await rpc("weekly_summary", { p_week_start: week });
  if (result.status === 400) return fail("validation", "validation");
  if (result.status >= 400 || result.json == null || typeof result.json !== "object" || Array.isArray(result.json)) {
    return fail("refused", READ_REFUSED);
  }
  return ok(result.json);
}
