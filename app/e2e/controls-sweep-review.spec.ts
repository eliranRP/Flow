import { sweepControls } from "./control-sweep";

// The no-op control sweep for Review, Filed today and the change sheet.
sweepControls([
  "/review?preview=1",
  "/review/filed?preview=1",
  "/review/change?preview=1",
  "/e2e/review-banner",
  "/e2e/filed?preview=1",
  "/e2e/review",
  "/e2e/change?preview=1",
]);
