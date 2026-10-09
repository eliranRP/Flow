import { sweepControls } from "./control-sweep";

// The no-op control sweep for Projects, a project, transactions, split and Unpaid.
sweepControls([
  "/projects?preview=1",
  "/projects/herzl?preview=1",
  "/e2e/projects?preview=1",
  "/e2e/project-detail?preview=1",
  "/e2e/project-months?preview=1",
  "/transactions/1?preview=1",
  "/e2e/txn?preview=1",
  "/e2e/split",
  "/unpaid?preview=1",
  "/e2e/unpaid?preview=1",
  "/e2e/missing-bills?preview=1",
]);
