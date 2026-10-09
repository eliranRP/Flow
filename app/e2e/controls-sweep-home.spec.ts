import { sweepControls } from "./control-sweep";

// The no-op control sweep for Home, Add, sign-in, help, legal and install.
sweepControls([
  "/?preview=1",
  "/?preview=error",
  "/e2e/home?preview=1",
  "/add?preview=1",
  "/sign-in",
  "/sign-in?error=server_error",
  "/help",
  "/terms",
  "/privacy",
  "/install?preview=1",
  "/e2e/install-android",
  "/e2e/install-other",
]);
