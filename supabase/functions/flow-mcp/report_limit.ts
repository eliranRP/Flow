// FLOW-166: the report file's per-user limit (bump_report_rate, 10 files a minute), counted before any
// read, the same for the app's report route and the MCP tool export_report.

type ServiceRpc = (name: string, body: Record<string, unknown>) => Promise<{ status: number; json: unknown }>;

/** "allowed", "unavailable" when the count fails, or the seconds to wait. */
export async function reportLimit(rpc: ServiceRpc, userId: string): Promise<"allowed" | "unavailable" | { retry: number }> {
  const result = await rpc("bump_report_rate", { p_user: userId });
  const body = result.json as { allowed?: unknown; retry_after_seconds?: unknown } | null;
  if (result.status >= 400 || typeof body?.allowed !== "boolean") return "unavailable";
  if (body.allowed) return "allowed";
  return { retry: typeof body.retry_after_seconds === "number" ? body.retry_after_seconds : 1 };
}
