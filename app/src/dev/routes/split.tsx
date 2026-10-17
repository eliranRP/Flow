import { lazy, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { SplitScreen } from "../../screens/flow-screens";
import type { DevRoute } from "./types";

const DevLineSplit = /* @__PURE__ */ lazy(() => import("../../dev/line-split-e2e").then((m) => ({ default: m.DevLineSplit })));

/** The saved rows, in a node outside React so they stay readable after the screen leaves. */
function splitSavedNode(): HTMLElement {
  let node = document.getElementById("e2e-split-saved");
  if (node == null) {
    node = document.createElement("div");
    node.id = "e2e-split-saved";
    node.hidden = true;
    document.body.append(node);
  }
  return node;
}

export function DevSplit() {
  const [params] = useSearchParams();
  const fail = params.get("save") === "fail";
  useEffect(() => {
    splitSavedNode().textContent = "";
  }, []);
  return (
    <SplitScreen
      sampleAmount={1001n}
      sampleProjects={[
        { id: "a", name: "שיפוץ הרצל 12" },
        { id: "b", name: "שיפוץ דירה ביאליק 8 חולון" },
        { id: "c", name: "פרגולה בית כהן" },
      ]}
      onSave={(rows) => {
        if (fail) throw new Error("save");
        splitSavedNode().textContent = JSON.stringify(rows);
        return undefined;
      }}
    />
  );
}

export const splitRoutes: DevRoute[] = [
  { path: "split", element: <DevSplit /> },
  { path: "split-category", element: <DevLineSplit /> },
];
