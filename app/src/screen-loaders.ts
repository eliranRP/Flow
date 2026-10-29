/**
 * FLOW-804: every screen but Home loads on demand, so the first paint of Home downloads and runs
 * only Home's code. preloadScreens fetches the rest once Home is up, so a tap rarely waits.
 * Sign-in stays in the first load: it is a signed-out visitor's first screen. The setup routes
 * load on demand (FLOW-827).
 */
export const screenLoaders = {
  review: () => import("./screens/review-screen"),
  changeForm: () => import("./screens/change-form"),
  addForm: () => import("./screens/add-sheet"),
  projects: () => import("./screens/projects-screen"),
  projectDetail: () => import("./screens/project-detail-screen"),
  filedToday: () => import("./screens/filed-today-screen"),
  projectInvestment: () => import("./screens/project-investment-screen"),
  projectCategory: () => import("./screens/project-category-screen"),
  unpaid: () => import("./screens/unpaid-screen"),
  transfers: () => import("./screens/transfers-screen"),
  recurring: () => import("./screens/recurring-screen"),
  recurringCharge: () => import("./screens/recurring-charge-screen"),
  invoice: () => import("./screens/invoice-screen"),
  transaction: () => import("./screens/transaction-screen"),
  settings: () => import("./screens/settings-screen"),
  connections: () => import("./screens/connections-screen"),
  business: () => import("./screens/business-screen"),
  connectionPages: () => import("./screens/connection-pages"),
  mercuryConnection: () => import("./screens/mercury-connection-screen"),
  assistant: () => import("./screens/assistant-settings"),
  notifications: () => import("./screens/notifications-screen"),
  categories: () => import("./screens/categories-screen"),
  cashLines: () => import("./screens/cash-lines-screen"),
  companyProfit: () => import("./screens/company-profit-screen"),
  reports: () => import("./screens/reports-screen"),
  reportLines: () => import("./screens/report-lines-screen"),
  projectProfit: () => import("./screens/project-profit-screen"),
  projectMonthProfit: () => import("./screens/project-month-profit-screen"),
  projectNextMonth: () => import("./screens/project-next-month-screen"),
  projectNextEdit: () => import("./screens/project-next-edit-screen"),
  search: () => import("./screens/search"),
  forecast: () => import("./screens/forecast-screen"),
  lineSplit: () => import("./screens/line-split"),
  journalComposer: () => import("./screens/journal-composer-screen"),
  loans: () => import("./screens/loans-screen"),
  loanDetail: () => import("./screens/loan-detail-screen"),
  loansSummary: () => import("./screens/loans-summary-screen"),
  help: () => import("./screens/HelpScreen"),
  legal: () => import("./screens/LegalScreen"),
  install: () => import("./ui/install-screen"),
  setupSteps: () => import("./setup/steps"),
  setupRoutes: () => import("./setup/route-screens"),
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
  await Promise.all([preloadSheet(), ...Object.values(screenLoaders).map((load) => load().catch(() => undefined))]);
}

/**
 * FLOW-425: the sheet code (vaul) is not in Home's entry, so the first sheet on a screen waited for
 * it. App loads it with the screens on idle, and on the first pointerdown, which lands before the
 * opener's click. Loading it twice is free: loadSheetDrawer keeps one promise.
 */
export function preloadSheet(): Promise<void> {
  return import("./ui/sheet").then(({ loadSheetDrawer }) => loadSheetDrawer()).then(() => undefined, () => undefined);
}
