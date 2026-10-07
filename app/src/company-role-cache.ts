/** Last successful role, keyed by user id. The value names the company. */
const COMPANY_ROLE_CACHE_KEY = "flow-company-role";

export type KnownRole = { companyId: string; role: "owner" | "viewer" };

export function readRoleCache(userId: string): KnownRole | null {
  try {
    const raw = localStorage.getItem(COMPANY_ROLE_CACHE_KEY);
    if (raw == null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed == null) return null;
    const entry = (parsed as Record<string, unknown>)[userId];
    if (typeof entry !== "object" || entry == null) return null;
    const companyId = (entry as { companyId?: unknown }).companyId;
    const role = (entry as { role?: unknown }).role;
    if (typeof companyId !== "string") return null;
    if (role !== "owner" && role !== "viewer") return null;
    return { companyId, role };
  } catch {
    return null;
  }
}

export function writeRoleCache(userId: string, companyId: string, role: "owner" | "viewer") {
  try {
    const raw = localStorage.getItem(COMPANY_ROLE_CACHE_KEY);
    const parsed: Record<string, KnownRole> = {};
    if (raw != null) {
      const stored: unknown = JSON.parse(raw);
      if (typeof stored === "object" && stored != null) {
        for (const [key, value] of Object.entries(stored)) {
          if (typeof value !== "object" || value == null) continue;
          const storedCompany = (value as { companyId?: unknown }).companyId;
          const storedRole = (value as { role?: unknown }).role;
          if (typeof storedCompany !== "string") continue;
          if (storedRole !== "owner" && storedRole !== "viewer") continue;
          parsed[key] = { companyId: storedCompany, role: storedRole };
        }
      }
    }
    parsed[userId] = { companyId, role };
    localStorage.setItem(COMPANY_ROLE_CACHE_KEY, JSON.stringify(parsed));
  } catch {
    // This visit still resolves from the read itself.
  }
}

/** Sign-out and a user switch drop the saved role, so a shared device keeps none. */
export function forgetCompanyRole(userId: string): void {
  try {
    const raw = localStorage.getItem(COMPANY_ROLE_CACHE_KEY);
    if (raw == null) return;
    const stored: unknown = JSON.parse(raw);
    if (typeof stored !== "object" || stored == null) {
      localStorage.removeItem(COMPANY_ROLE_CACHE_KEY);
      return;
    }
    const rest = Object.fromEntries(Object.entries(stored).filter(([key]) => key !== userId));
    if (Object.keys(rest).length === 0) localStorage.removeItem(COMPANY_ROLE_CACHE_KEY);
    else localStorage.setItem(COMPANY_ROLE_CACHE_KEY, JSON.stringify(rest));
  } catch {
    try {
      localStorage.removeItem(COMPANY_ROLE_CACHE_KEY);
    } catch {
      // A private window can refuse the delete. Nothing else reads a stale role.
    }
  }
}
