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
  propertyReturns: () => import("./screens/project-returns-screen"),
  propertyReturnsDetail: () => import("./screens/project-returns-detail-screen"),
  projectCategory: () => import("./screens/project-category-screen"),
  unpaid: () => import("./screens/unpaid-screen"),
  transfers: () => import("./screens/transfers-screen"),
  recurring: () => import("./screens/recurring-screen"),
  recurringCharge: () => import("./screens/recurring-charge-screen"),
  recurringChanges: () => import("./screens/recurring-changes-screen"),
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
  reportAccount: () => import("./screens/report-account-screen"),
  projectProfit: () => import("./screens/project-profit-screen"),
  projectMonthProfit: () => import("./screens/project-month-profit-screen"),
  projectNextMonth: () => import("./screens/project-next-month-screen"),
  projectNextEdit: () => import("./screens/project-next-edit-screen"),
  search: () => import("./screens/search"),
  forecast: () => import("./screens/forecast-screen"),
  companyNextMonth: () => import("./screens/company-next-month-screen"),
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
  companySheet: () => import("./screens/company-sheet"),
};

/**
 * How many screens the idle preload fetches at once. All ~45 at once (about 170 files) filled a 4G link
 * for over a second, so a screen tapped meanwhile waited behind them: Review's first visit took 2.1 s
 * on the FLOW-804 phone, against 0.9 s once they were in (perf report 2026-11-01).
 */
export const PRELOAD_AT_ONCE = 3;

/**
 * Fetches every on-demand screen, `atOnce` at a time in the order of screenLoaders; App calls it once
 * the browser is idle. If a fetch fails here, the tap fetches again. Tests await it so a lazy screen
 * renders on the next tick.
 */
export async function preloadScreens(atOnce = PRELOAD_AT_ONCE): Promise<void> {
  // FLOW-910: with them, the watch that reloads an open tab onto a new deploy's bundle; a new
  // worker takes over long after Home is up, and this keeps it out of Home's entry.
  void import("./sw-reload").then(({ watchServiceWorker }) => {
    watchServiceWorker();
  }, () => undefined);
  const queue = Object.values(screenLoaders);
  async function worker(): Promise<void> {
    for (let load = queue.shift(); load != null; load = queue.shift()) await load().catch(() => undefined);
  }
  await Promise.all([preloadSheet(), ...Array.from({ length: Math.min(queue.length, Math.max(1, atOnce)) }, worker)]);
}

/**
 * FLOW-425: the sheet code (vaul) is not in Home's entry, so the first sheet on a screen waited for
 * it. App loads it with the screens on idle, and on the first pointerdown, which lands before the
 * opener's click. Loading it twice is free: loadSheetDrawer keeps one promise.
 */
export function preloadSheet(): Promise<void> {
  return import("./ui/sheet").then(({ loadSheetDrawer }) => loadSheetDrawer()).then(() => undefined, () => undefined);
}
