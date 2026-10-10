import type { MyCompanies, TeamRole } from "./team-api";

/** Test support (FLOW-601). Invented ids only. */
export const TEST_COMPANY_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/**
 * The `list_my_companies` answer for a test that used to mock the companies row's owner: no
 * owner is no company yet, the signed-in owner is "owner", and anyone else gets `role` (viewer
 * unless the test says editor).
 */
export function myCompaniesFor(
  userId: string | null,
  ownerId: string | null,
  options: { companyId?: string; role?: Exclude<TeamRole, "owner">; name?: string } = {},
): MyCompanies {
  if (ownerId == null) return { active_id: null, role: null, companies: [] };
  const companyId = options.companyId ?? TEST_COMPANY_ID;
  const role: TeamRole = ownerId === userId ? "owner" : (options.role ?? "viewer");
  return {
    active_id: companyId,
    role,
    companies: [{ id: companyId, name: options.name ?? "חברה לדוגמה", role, is_demo: false, active: true }],
  };
}
