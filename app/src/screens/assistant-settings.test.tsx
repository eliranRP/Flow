import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test-render";
import { SAMPLE_ASSISTANT_KEYS, SAMPLE_ASSISTANT_SECRET, SAMPLE_EXPIRED_KEY } from "../assistant-sample";
import { addedToast, defaultKeyName } from "./assistant-keys";
import { AiConnectionPage } from "./assistant-settings";
import { EXAMPLE_QUESTIONS, NAME_FIELD } from "./assistant-setup";

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  }),
}));

const AI = "/settings/connections/ai";
const connected = { state: "connected", keys: SAMPLE_ASSISTANT_KEYS } as const;

describe("AI connection page: setup", () => {
  it("asks for a name, the scope and the assistant before minting, and shows no code yet", () => {
    renderWithProviders(<AiConnectionPage sample={{ state: "empty" }} sampleSecret={SAMPLE_ASSISTANT_SECRET} />, { route: AI });
    for (const question of EXAMPLE_QUESTIONS) expect(screen.getByText(question)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: NAME_FIELD })).toHaveAttribute("placeholder", "למשל: Claude במחשב העבודה");
    expect(screen.getByText("1 · מה העוזר יכול לעשות")).toBeInTheDocument();
    expect(screen.getByText("2 · באיזה עוזר")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "מה העוזר יכול לעשות" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "יצירת קוד" })).toBeInTheDocument();
    expect(screen.queryByText(SAMPLE_ASSISTANT_SECRET)).not.toBeInTheDocument();
    // With no key there is no list to go back to.
    expect(screen.queryByRole("link", { name: "כל המפתחות" })).not.toBeInTheDocument();
  });

  it("shows the Claude Code command as one field once a code is created, and an empty name takes the default", () => {
    vi.stubEnv("VITE_FLOW_MCP_URL", "https://mcp.example.test/mcp");
    renderWithProviders(<AiConnectionPage sample={{ state: "empty" }} sampleSecret={SAMPLE_ASSISTANT_SECRET} />, { route: AI });
    fireEvent.click(screen.getByRole("button", { name: "יצירת קוד" }));
    const command = screen.getByRole("textbox", { name: "פקודת חיבור" });
    expect((command as HTMLInputElement).value).toContain(SAMPLE_ASSISTANT_SECRET);
    expect(screen.queryByRole("textbox", { name: "כותרת" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: NAME_FIELD })).toHaveValue("Claude Code · מפתח 1");
    expect(screen.getByRole("textbox", { name: NAME_FIELD })).toHaveAttribute("readonly");
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
      { route: AI },
    );
    expect(screen.getByRole("textbox", { name: "כתובת שרת MCP" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "כותרת" })).toHaveValue(`Authorization: Bearer ${SAMPLE_ASSISTANT_SECRET}`);
    expect(screen.queryByRole("textbox", { name: "פקודת חיבור" })).not.toBeInTheDocument();
    vi.unstubAllEnvs();
  });

  it("selects the header for a manual copy when the clipboard refuses", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new DOMException("denied", "NotAllowedError")) },
    });
    renderWithProviders(
      <AiConnectionPage
        sample={{ state: "empty" }}
        initialSecret={{ id: "mcp-1", secret: SAMPLE_ASSISTANT_SECRET, scope: ["read"] }}
        initialClient="other"
      />,
      { route: AI },
    );
    const field = screen.getByRole("group", { name: "כותרת" });
    fireEvent.click(within(field).getByRole("button", { name: "העתקה: כותרת" }));
    expect(await within(field).findByRole("status")).toHaveTextContent("העתיקו ידנית");
    const input = within(field).getByRole("textbox", { name: "כותרת" });
    if (!(input instanceof HTMLInputElement)) throw new Error("not an input");
    expect(input).toHaveFocus();
    expect(input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0)).toBe(`Authorization: Bearer ${SAMPLE_ASSISTANT_SECRET}`);
  });
});

describe("AI connection page: keys", () => {
  it("opens on the key list once there is a key", () => {
    renderWithProviders(<AiConnectionPage sample={connected} />, { route: AI });
    expect(screen.getByRole("heading", { name: "מפתחות פעילים · 2" })).toBeInTheDocument();
    const work = screen.getByRole("link", { name: /^Claude Code · מחשב עבודה/ });
    expect(work).toHaveAttribute("href", `${AI}/key/mcp-key-1`);
    expect(within(work).getByText("קריאה וכתיבה")).toHaveClass("ui-row-value-accent");
    const phone = screen.getByRole("link", { name: /^Claude.ai · טלפון/ });
    expect(within(phone).getByText("קריאה בלבד")).not.toHaveClass("ui-row-value-accent");
    expect(within(phone).getByText("עוד לא בשימוש")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "+ מפתח חדש" })).toHaveAttribute("href", `${AI}/new`);
    expect(screen.getByText(/ביטול מפתח אחד לא נוגע באחרים/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "יצירת קוד" })).not.toBeInTheDocument();
  });

  it("shows one key's facts, and revoking it returns to the list with an undo", async () => {
    renderWithProviders(<AiConnectionPage sample={connected} />, { route: `${AI}/key/mcp-key-1` });
    expect(screen.getByText("Claude Code · מחשב עבודה")).toBeInTheDocument();
    for (const label of ["עוזר", "שימוש אחרון", "נוצר", "בתוקף עד"]) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(screen.getByText("09/10/2026")).toBeInTheDocument();
    expect(screen.getByText("07/01/2027")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "כל המפתחות" })).toHaveAttribute("href", AI);
    fireEvent.click(screen.getByRole("button", { name: "ביטול המפתח" }));
    expect(await screen.findByRole("heading", { name: "מפתחות פעילים · 1" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Claude Code · מחשב עבודה/ })).not.toBeInTheDocument();
    const toast = await screen.findByText("המפתח בוטל · Claude Code · מחשב עבודה");
    fireEvent.click(within(toast.closest(".ui-toast") ?? document.body).getByRole("button", { name: "ביטול" }));
    expect(await screen.findByRole("heading", { name: "מפתחות פעילים · 2" })).toBeInTheDocument();
  });

  it("adds a named key from + מפתח חדש, and it joins the list", async () => {
    renderWithProviders(<AiConnectionPage sample={connected} sampleSecret={SAMPLE_ASSISTANT_SECRET} />, { route: `${AI}/new` });
    expect(screen.getByRole("link", { name: "כל המפתחות" })).toHaveAttribute("href", AI);
    fireEvent.change(screen.getByRole("textbox", { name: NAME_FIELD }), { target: { value: "ChatGPT בטאבלט" } });
    fireEvent.click(screen.getByRole("radio", { name: "ChatGPT" }));
    fireEvent.click(screen.getByRole("button", { name: "יצירת קוד" }));
    fireEvent.click(screen.getByRole("button", { name: "סיום" }));
    expect(await screen.findByRole("heading", { name: "מפתחות פעילים · 3" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^ChatGPT בטאבלט/ })).toBeInTheDocument();
    expect(await screen.findByText("המפתח נוסף · 3 מפתחות פעילים")).toBeInTheDocument();
  });

  it("puts expired keys in the problem box, marks them, and shows a key from before names with a fallback", () => {
    renderWithProviders(<AiConnectionPage sample={{ state: "expired", keys: [SAMPLE_EXPIRED_KEY] }} />, { route: AI });
    expect(screen.getByText("הקוד פג אחרי 90 יום. צרו מפתח חדש כדי להמשיך.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "מפתחות פעילים · 0" })).toBeInTheDocument();
    const row = screen.getByRole("link", { name: /^מפתח AI/ });
    expect(within(row).getByText("פג תוקף")).toHaveClass("ui-row-value-signal");
  });

  it("a key page without an assistant leaves that row out, and an unknown key goes back to the list", () => {
    const { unmount } = renderWithProviders(<AiConnectionPage sample={{ state: "expired", keys: [SAMPLE_EXPIRED_KEY] }} />, { route: `${AI}/key/mcp-key-old` });
    expect(screen.queryByText("עוזר")).not.toBeInTheDocument();
    expect(screen.getByText("30/06/2026")).toHaveClass("ui-row-value-signal");
    unmount();
    renderWithProviders(<AiConnectionPage sample={connected} />, { route: `${AI}/key/gone` });
    expect(screen.getByRole("heading", { name: "מפתחות פעילים · 2" })).toBeInTheDocument();
  });

  it("names and counts keys the way the note asks", () => {
    expect(defaultKeyName("claude-ai", 2)).toBe("Claude.ai · מפתח 3");
    expect(defaultKeyName("other", 0)).toBe("אחר · מפתח 1");
    expect(addedToast(3)).toBe("המפתח נוסף · 3 מפתחות פעילים");
    expect(addedToast(1)).toBe("המפתח נוסף · מפתח פעיל אחד");
  });
});

describe("AI connection page: who sees what", () => {
  it("tells a viewer that only the owner can connect the assistant", () => {
    renderWithProviders(<AiConnectionPage sample={{ state: "empty" }} readOnly />, { route: AI });
    expect(screen.getByText("רק בעל העסק יכול לחבר את העוזר.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "יצירת קוד" })).not.toBeInTheDocument();
  });

  it("shows a read-only list without the actions", async () => {
    renderWithProviders(<AiConnectionPage sample={connected} readOnly />, { route: AI });
    expect(screen.getByRole("heading", { name: "מפתחות פעילים · 2" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "+ מפתח חדש" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: /^Claude.ai · טלפון/ }));
    await waitFor(() => { expect(screen.getByText("Claude.ai")).toBeInTheDocument(); });
    expect(screen.queryByRole("button", { name: "ביטול המפתח" })).not.toBeInTheDocument();
  });

  it("offers a link to the business details when there is no company", () => {
    renderWithProviders(<AiConnectionPage sample={{ state: "no-company" }} />, { route: AI });
    expect(screen.getByText("כדי לחבר עוזר צריך עסק.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "פרטי העסק" })).toHaveAttribute("href", "/setup/1");
  });
});
