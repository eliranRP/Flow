/**
 * FLOW-804: every screen but Home loads on demand, so the first paint of Home downloads and runs
 * only Home's code. preloadScreens fetches the rest once Home is up, so a tap rarely waits.
 * Sign-in stays in the first load: it is a signed-out visitor's first screen.
 */
export const screenLoaders = {
  review: () => import("./screens/review-screen"),
  changeForm: () => import("./screens/change-form"),
  addForm: () => import("./screens/add-sheet"),
  onboarding: () => import("./screens/onboarding-screen"),
  projects: () => import("./screens/projects-screen"),
  projectDetail: () => import("./screens/project-detail-screen"),
  projectCash: () => import("./screens/project-cash-screens"),
  projectCashHistory: () => import("./screens/project-cash-history"),
  projectGroup: () => import("./screens/project-group-screen"),
  filedToday: () => import("./screens/filed-today-screen"),
  projectCategory: () => import("./screens/project-category-screen"),
  unpaid: () => import("./screens/unpaid-screen"),
  transaction: () => import("./screens/transaction-screen"),
  split: () => import("./screens/split-screen"),
  settings: () => import("./screens/settings-screen"),
  connections: () => import("./screens/connections-screen"),
  notifications: () => import("./screens/notifications-screen"),
  categories: () => import("./screens/categories-screen"),
  breakdown: () => import("./screens/breakdown"),
  cash: () => import("./screens/cash-screens"),
  cashHistory: () => import("./screens/cash-history"),
  profitMonths: () => import("./screens/profit-months"),
  search: () => import("./screens/search"),
  missingBills: () => import("./screens/missing-bills-screen"),
  lineSplit: () => import("./screens/line-split"),
  loanDetail: () => import("./screens/loan-detail-screen"),
  help: () => import("./screens/HelpScreen"),
  legal: () => import("./screens/PlaceholderScreen"),
  install: () => import("./ui/install-screen"),
  setupSteps: () => import("./setup/steps"),
  team: () => import("./screens/team-screen"),
  invites: () => import("./screens/invites-screen"),
};

/**
 * Fetches every on-demand screen; App calls it once the browser is idle. If a fetch fails here,
 * the tap fetches again. Tests await it so a lazy screen renders on the next tick.
 */
export async function preloadScreens(): Promise<void> {
  // FLOW-910: with them, the watch that reloads an open tab onto a new deploy's bundle; a new
  // worker takes over long after Home is up, and this keeps it out of Home's entry.
  void import("./sw-reload").then(({ watchServiceWorker }) => {
    watchServiceWorker();
  }, () => undefined);
  await Promise.all(Object.values(screenLoaders).map((load) => load().catch(() => undefined)));
}
