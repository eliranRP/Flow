import { readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LEGAL_DOC_MARK, LEGAL_DRAFT_LINE, PRIVACY, TERMS, type LegalText } from "../legal-copy";
import type { NotificationPrefs, SubscribeOutcome } from "../push";
import { renderWithProviders } from "../test-render";

// FLOW-977 (decision 0225): the rare screens' review. חזרה from help and the legal pages, help's
// sign-in tips, the legal draft (and its copy for the lawyer), and the push question's toast place.

let status: "anon" | "authed" = "anon";
vi.mock("../auth", () => ({ useAuth: () => ({ status, session: null }) }));

const rpc = vi.fn();
vi.mock("../lib/supabase", () => ({ getSupabase: () => ({ rpc: (...args: unknown[]) => rpc(...args) as unknown }) }));
const subscribe = vi.fn<() => Promise<SubscribeOutcome>>();
vi.mock("../push", async (original) => {
  const actual = await original<typeof import("../push")>();
  const { useQuery } = await import("@tanstack/react-query");
  return {
    ...actual,
    subscribeThisDevice: () => subscribe(),
    useDevicePushQuery: (enabled: boolean) => useQuery({ queryKey: actual.DEVICE_PUSH_KEY, enabled, queryFn: () => Promise.resolve({ state: "not-subscribed", tag: null }) }),
  };
});

const { HelpScreen, SIGN_IN_TIPS } = await import("./HelpScreen");
const { LegalScreen } = await import("./LegalScreen");
const { PUSH_QUESTION, ReviewPushPrompt } = await import("./review-push-prompt");
// Loaded once here: a cold import of the whole reviewer view can outrun one test's time limit.
const { ReviewerPreview } = await import("../reviewer-preview");

beforeEach(() => {
  status = "anon";
  rpc.mockReset();
  subscribe.mockReset();
});

/** Opens `page` as a fresh entry (a deep link), so חזרה falls back instead of popping. */
function openFresh(path: string, page: React.ReactNode) {
  renderWithProviders(
    <Routes>
      <Route path={path} element={page} />
      <Route path="/sign-in" element={<p>sign-in page</p>} />
      <Route path="/" element={<p>home page</p>} />
    </Routes>,
    { route: path },
  );
}

describe("help", () => {
  it("signed out: the sign-in tips sit above the address, and חזרה goes to sign-in", () => {
    openFresh("/help", <HelpScreen />);
    for (const tip of SIGN_IN_TIPS) expect(screen.getByText(tip)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /@/ })).toHaveAttribute("href", expect.stringMatching(/^mailto:/));
    fireEvent.click(screen.getByRole("button", { name: "חזרה" }));
    expect(screen.getByText("sign-in page")).toBeInTheDocument();
  });

  it("signed in: no sign-in tips, and חזרה goes Home, not to sign-in", () => {
    status = "authed";
    openFresh("/help", <HelpScreen />);
    expect(screen.queryByText(SIGN_IN_TIPS[0])).not.toBeInTheDocument();
    expect(screen.getByText("יש שאלה או תקלה? כותבים לנו.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "חזרה" }));
    expect(screen.getByText("home page")).toBeInTheDocument();
  });
});

describe("terms and privacy", () => {
  it.each([["terms", TERMS], ["privacy", PRIVACY]] as const)("%s: the title, the draft line first, then every section", (kind, text) => {
    openFresh(`/${kind}`, <LegalScreen kind={kind} />);
    expect(screen.getByRole("heading", { level: 1, name: text.title })).toBeInTheDocument();
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent(LEGAL_DRAFT_LINE);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((node) => node.textContent);
    expect(headings).toEqual(text.sections.map((section) => section.heading));
    // The draft line opens the page, before the first section.
    expect(note.compareDocumentPosition(screen.getAllByRole("heading", { level: 2 })[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("חזרה goes to sign-in signed out, and Home signed in", () => {
    openFresh("/terms", <LegalScreen kind="terms" />);
    fireEvent.click(screen.getByRole("button", { name: "חזרה" }));
    expect(screen.getByText("sign-in page")).toBeInTheDocument();
  });

  it("never names a company detail it does not know: those stay as [ ] for the owner and the lawyer", () => {
    const all = [...TERMS.sections, ...PRIVACY.sections].flatMap((section) => section.paragraphs).join("\n");
    expect(all).toContain("[שם החברה]");
    expect(all).toContain("[דוא״ל ליצירת קשר]");
    expect(all).not.toMatch(/@\w/);
  });
});

describe("the lawyer's copy in docs/legal", () => {
  function doc(name: string): string {
    // Vitest runs from app/; a jsdom test's import.meta.url is a served path, not a file.
    return readFileSync(path.resolve(process.cwd(), "../docs/legal", name), "utf8");
  }

  it.each([["terms-draft.md", TERMS], ["privacy-draft.md", PRIVACY]] as const)("%s holds the app's text word for word, marked as a draft", (name, text: LegalText) => {
    const body = doc(name);
    expect(body).toContain(LEGAL_DOC_MARK);
    expect(body).toContain(`# ${text.title}`);
    for (const section of text.sections) {
      expect(body).toContain(`## ${section.heading}`);
      for (const line of section.paragraphs) expect(body).toContain(line);
    }
    const docHeadings = body.split("\n").filter((line) => line.startsWith("## ")).map((line) => line.slice(3));
    expect(docHeadings).toEqual(text.sections.map((section) => section.heading));
  });
});

describe("the push question", () => {
  const unanswered: NotificationPrefs = { new_transaction: false, evening_reminder: false, weekly_summary: false, prompt_answered: false };

  it("names both alerts in one question, and a refusal's note sits under the header", async () => {
    rpc.mockImplementation((name: string) => Promise.resolve({ data: name === "answer_push_prompt" ? { ...unanswered, prompt_answered: true } : unanswered, error: null }));
    subscribe.mockResolvedValue({ result: "denied", step: "permission" });
    renderWithProviders(<ReviewPushPrompt support="ok" />, { route: "/review" });
    expect(await screen.findByText(PUSH_QUESTION)).toBeInTheDocument();
    expect(PUSH_QUESTION).toContain("תנועה חדשה");
    expect(PUSH_QUESTION).toContain("תזכורת בערב");
    fireEvent.click(screen.getByRole("button", { name: "כן" }));
    const toast = await screen.findByText(/ההתראות חסומות/);
    await waitFor(() => { expect(toast.closest("[data-place]")).toHaveAttribute("data-place", "top"); });
  });
});

describe("the reviewer view", () => {
  it.each(["/reviewer", "/reviewer/review", "/reviewer/filed", "/reviewer/waiting", "/reviewer/split"])("%s carries the sample mark", (route) => {
    renderWithProviders(<ReviewerPreview />, { route });
    expect(screen.getByText("נתוני דוגמה · Example data")).toBeInTheDocument();
  });
});
