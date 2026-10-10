// Git settings for tests that build throwaway repos. A pre-push hook runs with GIT_DIR (and in a
// worktree also GIT_WORK_TREE and GIT_INDEX_FILE) set, and git obeys them over `cwd`: a test's
// `git init`, config, commits and checkouts would land in the repo being pushed.

/** The environment without git's repository overrides (every GIT_* variable). */
export function isolatedEnv(env = process.env) {
  const clean = { ...env };
  for (const key of Object.keys(clean)) {
    if (key.startsWith("GIT_")) delete clean[key];
  }
  return clean;
}

/**
 * Drops the GIT_* variables from this process, so in-process git calls and every child process a
 * test starts see only the temp repo. Call it at the top of a test file that runs git.
 */
export function scrubGitEnv() {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("GIT_")) delete process.env[key];
  }
}
