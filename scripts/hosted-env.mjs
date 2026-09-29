/** A hosted build must not ship with an explicit empty Supabase URL or anon key. */

const hostedKeys = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"];

/**
 * @param {Record<string, string | undefined>} env
 * @param {boolean} reviewerBuild
 * @returns {string[]}
 */
export function rejectEmptyHostedSupabase(env, reviewerBuild) {
  if (reviewerBuild) return [];
  const problems = [];
  for (const key of hostedKeys) {
    if (env[key] === "") problems.push(`${key} is set but empty`);
  }
  return problems;
}
