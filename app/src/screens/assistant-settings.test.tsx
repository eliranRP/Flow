import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test-render";
import { SAMPLE_ASSISTANT_SECRET } from "../assistant-sample";
import { AiConnectionPage, EXAMPLE_QUESTIONS } from "./assistant-settings";

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  }),
}));

describe("AI connection page", () => {
  it("asks for the scope and assistant before minting, and shows no code yet", () => {
    renderWithProviders(<AiConnectionPage sample={{ state: "empty" }} sampleSecret={SAMPLE_ASSISTANT_SECRET} />);
    for (const question of EXAMPLE_QUESTIONS) expect(screen.getByText(question)).toBeInTheDocument();
    expect(screen.getByText("1 · מה העוזר יכול לעשות")).toBeInTheDocument();
    expect(screen.getByText("2 · באיזה עוזר")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "מה העוזר יכול לעשות" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "יצירת קוד" })).toBeInTheDocument();
    expect(screen.queryByText(SAMPLE_ASSISTANT_SECRET)).not.toBeInTheDocument();
  });

  it("shows the Claude Code command as one field once a code is created", () => {
    vi.stubEnv("VITE_FLOW_MCP_URL", "https://mcp.example.test/mcp");
    renderWithProviders(<AiConnectionPage sample={{ state: "empty" }} sampleSecret={SAMPLE_ASSISTANT_SECRET} />);
    fireEvent.click(screen.getByRole("button", { name: "יצירת קוד" }));
    const command = screen.getByRole("textbox", { name: "פקודת חיבור" });
    expect((command as HTMLInputElement).value).toContain(SAMPLE_ASSISTANT_SECRET);
    expect(screen.queryByRole("textbox", { name: "כותרת" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "סיום" })).toBeInTheDocument();
    expect(screen.getByText(/הקוד מוצג פעם אחת/)).toBeInTheDocument();
    vi.unstubAllEnvs();
  });

  it("shows the address and the bearer header for the other assistants", () => {
    vi.stubEnv("VITE_FLOW_MCP_URL", "https://mcp.example.test/mcp");
    renderWithProviders(
      <AiConnectionPage
        sample={{ state: "empty" }}
        initialSecret={{ id: "mcp-1", secret: SAMPLE_ASSISTANT_SECRET, scope: ["read", "write"] }}
        initialClient="chatgpt"
      />,
    );
    expect(screen.getByRole("textbox", { name: "כתובת שרת MCP" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "כותרת" })).toHaveValue(`Authorization: Bearer ${SAMPLE_ASSISTANT_SECRET}`);
    expect(screen.queryByRole("textbox", { name: "פקודת חיבור" })).not.toBeInTheDocument();
    vi.unstubAllEnvs();
  });

  it("shows the connected state with its scope, last use and the actions", () => {
    renderWithProviders(
      <AiConnectionPage
        sample={{ state: "connected", scope: "read_write", lastUsedAt: "2026-09-30T11:05:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z", id: "mcp-1" }}
      />,
    );
    expect(screen.getByText("מחובר")).toBeInTheDocument();
    expect(screen.getByText("שימוש אחרון")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "יצירת קוד חדש" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ניתוק" })).toBeInTheDocument();
    expect(screen.queryByText("כמה הוצאתי על Elm Court החודש?")).not.toBeInTheDocument();
  });

  it("asks before disconnecting, and the confirm sheet names what stays", () => {
    renderWithProviders(<AiConnectionPage sample={{ state: "connected", scope: "read", id: "mcp-1" }} />);
    fireEvent.click(screen.getByRole("button", { name: "ניתוק" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("לנתק את העוזר?")).toBeInTheDocument();
    expect(within(dialog).getByText("הקוד יפסיק לעבוד. הספרים נשארים.")).toBeInTheDocument();
  });

  it("puts an expired code in the problem box with one button", () => {
    renderWithProviders(<AiConnectionPage sample={{ state: "expired", scope: "read_write", id: "mcp-1" }} />);
    expect(screen.getByText("הקוד פג אחרי 90 יום. צרו קוד חדש כדי להמשיך.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "יצירת קוד חדש" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניתוק" })).not.toBeInTheDocument();
  });

  it("tells a viewer that only the owner can connect the assistant", () => {
    renderWithProviders(<AiConnectionPage sample={{ state: "empty" }} readOnly />);
    expect(screen.getByText("רק בעל העסק יכול לחבר את העוזר.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "יצירת קוד" })).not.toBeInTheDocument();
  });

  it("offers a link to the business details when there is no company", () => {
    renderWithProviders(<AiConnectionPage sample={{ state: "no-company" }} />);
    expect(screen.getByText("כדי לחבר עוזר צריך עסק.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "פרטי העסק" })).toHaveAttribute("href", expect.stringContaining("/onboarding"));
  });
});
