// MCP tools: the zod schemas for the team writes (invite, role, remove). Split out of tools_schemas.ts (FLOW-142).

import { z } from "zod";
import { IDEMPOTENCY_KEY, UUID_TEXT } from "./tools_schemas.ts";

// FLOW-601. The database lower-cases and checks the email; this only bounds it.
export const inviteMemberSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  email: z.string().trim().min(3).max(254),
  role: z.enum(["editor", "viewer"]).default("viewer"),
}).strict();
// member_id is the member's user id from list_team (user_id is reserved for the token's identity).
export const setMemberRoleSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  member_id: UUID_TEXT,
  role: z.enum(["editor", "viewer"]),
}).strict();
export const removeMemberSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  member_id: UUID_TEXT,
}).strict();
