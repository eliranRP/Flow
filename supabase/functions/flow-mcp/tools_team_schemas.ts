// MCP tools: the zod schemas for the team writes (remove; inviting and role changes are not MCP writes, decision 0241). Split out of tools_schemas.ts (FLOW-142).

import { z } from "zod";
import { IDEMPOTENCY_KEY, UUID_TEXT } from "./tools_schemas.ts";

// member_id is the member's user id from list_team (user_id is reserved for the token's identity).
export const removeMemberSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  member_id: UUID_TEXT,
}).strict();
