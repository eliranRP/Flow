import { sweepControls } from "./control-sweep";

// The no-op control sweep for Settings, Connections, Loans, Categories, onboarding and notifications.
sweepControls([
  "/settings?preview=1",
  "/settings/categories?preview=1",
  "/settings/connections?preview=1",
  "/settings/loans?preview=1",
  "/onboarding?preview=1",
  "/notifications?preview=1",
  "/e2e/settings?preview=1",
  "/e2e/connections?preview=1",
  "/e2e/connections?preview=1&connected=1",
  "/e2e/connections?preview=1&connected=auth",
  "/e2e/loans?preview=1",
  "/e2e/categories?preview=1",
]);
