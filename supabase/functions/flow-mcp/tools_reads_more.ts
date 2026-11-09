// MCP reads that live in their own modules, routed from readTool in tools.ts: the weekly summary (FLOW-517),
// a line's notes and files (FLOW-957) and a property's returns (FLOW-450).
import type { ToolResult, ToolRpc } from "./tools_args.ts";
import { memberShareRead } from "./tools_member_share.ts";
import { propertyRead } from "./tools_property.ts";
import { threadRead } from "./tools_thread.ts";
import { UTILITY_READS, utilityRead } from "./tools_utility_refunds.ts";
import { weeklySummaryTool } from "./tools_weekly.ts";

/** The read's result, or null when the name is not one of these reads. */
export function moreRead(name: string, args: Record<string, unknown>, rpc: ToolRpc): Promise<ToolResult> | null {
  if (name === "get_weekly_summary") return weeklySummaryTool(args, rpc);
  if (name === "get_transaction_thread") return threadRead(args, rpc);
  if (name === "get_property_returns" || name === "get_property_return_lines") return propertyRead(name, args, rpc);
  if (name === "get_member_report" || name === "get_member_share" || name === "get_member_projection") return memberShareRead(name, args, rpc);
  if ((UTILITY_READS as readonly string[]).includes(name)) return utilityRead(name as typeof UTILITY_READS[number], args, rpc);
  return null;
}
