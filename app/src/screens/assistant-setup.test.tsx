import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test-render";
import { AssistantSetup, REVOKE_FAILED } from "./assistant-setup";

// FLOW-1164: a code minted and then re-scoped takes its old key back; when that fails, the page says so.
vi.mock("./assistant-keys", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./assistant-keys")>()),
  mintKey: vi.fn(() => Promise.resolve({ id: "mcp-1", secret: "invented-secret", scope: ["read", "write"] })),
  revokeKey: vi.fn(() => Promise.reject(new Error("Failed to fetch"))),
}));

describe("assistant setup: a code's revoke", () => {
  it("says the revoke failed when the access is changed and the old key cannot be taken back", async () => {
    renderWithProviders(
      <AssistantSetup
        keys={[]}
        allKeysTo={null}
        sample={false}
        guard={() => false}
        onMinted={() => undefined}
        onLeave={() => undefined}
        onAdded={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "יצירת קוד" }));
    await screen.findByRole("textbox", { name: "פקודת חיבור" });
    const group = screen.getByRole("radiogroup", { name: "מה העוזר יכול לעשות" });
    const other = within(group).getAllByRole("radio").find((radio) => radio.getAttribute("aria-checked") !== "true");
    if (other == null) throw new Error("no other access");
    fireEvent.click(other);
    expect(await screen.findByText(REVOKE_FAILED)).toBeInTheDocument();
  });
});
