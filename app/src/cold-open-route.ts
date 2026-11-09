/**
 * FLOW-1140: what a signed-in route draws while the session loads (a cold open) and, for a full-screen
 * route, while its code loads. Each route draws its own screen's loading frame, in its own outlet
 * (App.tsx: Shell under the tab bar, FullScreen without it), so nothing jumps when the screen lands.
 */

/** The body a route's loading frame draws: one of the light skeletons Home's first load already carries. */
export type ColdOpenShape =
  | "home"
  | "projects"
  | "loans"
  | "settings"
  | "recurring"
  | "profit"
  | "lines"
  | "detail"
  | "form"
  | "list";

/**
 * The bar above it: `band` the tab's band with its title, `plain` an inline title with no Back (as the
 * screen's loading state draws it), `back` Back's place and the stacked title, or Back alone when the
 * title is not known before the screen's read. `own` the shape draws its own head (Home, קבועים).
 */
export type ColdOpenBar = "band" | "plain" | "back" | "own";

export type ColdOpenRoute = {
  shape: ColdOpenShape;
  /** `tab`: the Shell outlet, under the tab bar; `full`: the FullScreen outlet. */
  layout: "tab" | "full";
  bar: ColdOpenBar;
  title?: string;
};

const routes: readonly (readonly [RegExp, ColdOpenRoute])[] = [
  // Home and the + sheet over it.
  [/^\/(add)?$/, { shape: "home", layout: "tab", bar: "own" }],
  // The FullScreen outlet: setup, invites, search, a line's split and journal entry, install.
  [/^\/setup(\/|$)/, { shape: "form", layout: "full", bar: "back" }],
  [/^\/invites$/, { shape: "list", layout: "full", bar: "plain", title: "הזמנות" }],
  [/^\/search$/, { shape: "list", layout: "full", bar: "back" }],
  [/^\/transactions\/[^/]+\/split-category$/, { shape: "form", layout: "full", bar: "back", title: "פיצול" }],
  [/^\/transactions\/[^/]+\/journal$/, { shape: "form", layout: "full", bar: "back", title: "פקודת יומן" }],
  [/^\/install$/, { shape: "list", layout: "full", bar: "back" }],
  // The Shell outlet, under the tab bar.
  [/^\/projects$/, { shape: "projects", layout: "tab", bar: "band", title: "פרויקטים" }],
  [/^\/loans$/, { shape: "loans", layout: "tab", bar: "band", title: "הלוואות" }],
  [/^\/projects\/(?!unassigned$)[^/]+$/, { shape: "list", layout: "tab", bar: "band" }],
  [/^\/reports(\/|$)/, { shape: "list", layout: "tab", bar: "band" }],
  [/^\/loans\/[^/]+(\/payments)?$/, { shape: "detail", layout: "tab", bar: "back" }],
  [/^\/settings$/, { shape: "settings", layout: "tab", bar: "plain", title: "הגדרות" }],
  [/^\/settings\//, { shape: "settings", layout: "tab", bar: "back" }],
  [/^\/recurring$/, { shape: "recurring", layout: "tab", bar: "own" }],
  [/^\/profit$/, { shape: "profit", layout: "tab", bar: "back" }],
  [/^\/projects\/[^/]+\/profit$/, { shape: "profit", layout: "tab", bar: "back" }],
  [/^\/(cash\/|unpaid$|transfers$|review\/filed$)/, { shape: "lines", layout: "tab", bar: "back" }],
  [/^\/review(\/all)?$/, { shape: "list", layout: "tab", bar: "back", title: "לאישור" }],
  [/^\/(transactions|unpaid)\/[^/]+$/, { shape: "detail", layout: "tab", bar: "back" }],
  [/^\/recurring\/[^/]+\/[^/]+$/, { shape: "detail", layout: "tab", bar: "back" }],
];

/** Any other signed-in route: a tab page with Back's place and rows. */
const fallback: ColdOpenRoute = { shape: "list", layout: "tab", bar: "back" };

/** The loading frame for a path (no search or hash). */
export function coldOpenRoute(pathname: string): ColdOpenRoute {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return routes.find(([pattern]) => pattern.test(path))?.[1] ?? fallback;
}
