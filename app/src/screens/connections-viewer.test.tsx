import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../test-render";
import { ViewerPreview } from "../use-is-viewer";
import { ConnectionsScreen } from "./flow-screens";
import { connectorWord } from "./connections-status";

const expired = {
  name: "אלפא",
  connected: true,
  companyId: 1,
  lastError: "sumit_auth",
  email: "dana@example.com",
  mercuryConnected: true,
  mercuryLastError: "auth",
  assistant: { state: "expired" as const },
  jev: { enabled: false, mode: "shadow" as const, threshold: 0.9, status: "ready" as const },
};

function renderScreen(node: ReactNode) {
  return renderWithProviders(node, { route: "/settings/connections" });
}

describe("connector rows for a viewer (FLOW-507)", () => {
  it("an expired SUMIT or Mercury key reads neutral, like the AI row, with no warning tone", () => {
    renderScreen(
      <ViewerPreview>
        <ConnectionsScreen sample={expired} />
      </ViewerPreview>,
    );
    expect(screen.getAllByText("לא מחובר")).toHaveLength(3);
    expect(screen.queryByText("צריך חיבור")).not.toBeInTheDocument();
    expect(document.querySelector(".ui-row-value-signal")).toBeNull();
  });

  it("an owner still sees צריך חיבור in the signal tone", () => {
    renderScreen(<ConnectionsScreen sample={expired} />);
    expect(screen.getAllByText("צריך חיבור").length).toBeGreaterThanOrEqual(2);
    expect(document.querySelectorAll(".ui-row-value-signal").length).toBeGreaterThanOrEqual(2);
  });

  it("names the read-only words", () => {
    expect(connectorWord("reconnect")).toBe("צריך חיבור");
    expect(connectorWord("reconnect", true)).toBe("לא מחובר");
    expect(connectorWord("connected", true)).toBe("מחובר");
  });
});
