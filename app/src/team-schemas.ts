import { z } from "zod";

/**
 * FLOW-601: the zod schemas of the team RPCs. Only team-api's live calls import this file, on
 * demand, so zod stays off Home's first load (FLOW-804), like read-schemas.ts.
 */

const teamRole = z.enum(["owner", "editor", "viewer"]);
const memberRole = z.enum(["editor", "viewer"]);

export const myCompaniesSchema = z.object({
  active_id: z.string().nullable(),
  role: teamRole.nullable(),
  companies: z.array(z.object({
    id: z.string(),
    name: z.string(),
    role: teamRole,
    is_demo: z.boolean(),
    active: z.boolean(),
  })),
});
export type MyCompanies = z.infer<typeof myCompaniesSchema>;
export type MyCompany = MyCompanies["companies"][number];

export const teamSchema = z.object({
  company_id: z.string(),
  role: teamRole,
  can_manage: z.boolean(),
  members: z.array(z.object({
    user_id: z.string(),
    name: z.string().nullable(),
    email: z.string().nullable(),
    role: teamRole,
    you: z.boolean(),
  })),
  invites: z.array(z.object({
    id: z.string(),
    email: z.string(),
    role: memberRole,
    created_at: z.string(),
  })),
});
export type Team = z.infer<typeof teamSchema>;
export type TeamMember = Team["members"][number];
export type TeamInvite = Team["invites"][number];

export const inviteResultSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: memberRole,
  status: z.string(),
  existing: z.boolean(),
});
export type InviteResult = z.infer<typeof inviteResultSchema>;

export const myInviteSchema = z.object({
  id: z.string(),
  company_id: z.string(),
  company_name: z.string(),
  role: memberRole,
  invited_by_name: z.string().nullable(),
  created_at: z.string(),
});
export type MyInvite = z.infer<typeof myInviteSchema>;
export const myInvitesSchema = z.array(myInviteSchema);

export const acceptResultSchema = z.object({
  id: z.string(),
  company_id: z.string(),
  name: z.string(),
  role: teamRole,
});
export type AcceptResult = z.infer<typeof acceptResultSchema>;
