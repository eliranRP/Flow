import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRIVACY, TERMS } from "../legal-copy";
import type { NotificationPrefs, SubscribeOutcome } from "../push";
import { renderWithProviders } from "../test-render";

// FLOW-977 (decision 0225): the rare screens' review. חזרה from help and the legal pages, help's
// sign-in tips, the legal pages (which never show the lawyer's draft), and the push note's place.

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
  it.each([["terms", TERMS], ["privacy", PRIVACY]] as const)("%s: the page title, then the live line in the reading style", (kind, text) => {
    openFresh(`/${kind}`, <LegalScreen kind={kind} />);
    expect(screen.getByRole("heading", { level: 1, name: text.title })).toBeInTheDocument();
    for (const line of text.paragraphs) expect(screen.getByText(line)).toHaveClass("t-body");
  });

  it("חזרה goes to sign-in signed out, and Home signed in", () => {
    openFresh("/terms", <LegalScreen kind="terms" />);
    fireEvent.click(screen.getByRole("button", { name: "חזרה" }));
    expect(screen.getByText("sign-in page")).toBeInTheDocument();
  });
});

describe("the lawyer's draft stays out of the app", () => {
  // Vitest runs from app/; a jsdom test's import.meta.url is a served path, not a file.
  const repo = path.resolve(process.cwd(), "..");
  const drafts = ["terms-draft.md", "privacy-draft.md"].map((name) => readFileSync(path.join(repo, "docs/legal", name), "utf8"));
  const draftHeadings = drafts.flatMap((body) => body.split("\n").filter((line) => line.startsWith("## ")).map((line) => line.slice(3)));
  const draftLines = drafts.flatMap((body) => body.split("\n").filter((line) => line.length > 40 && !line.startsWith("#") && !line.startsWith(">") && !line.startsWith("**")));

  it("the drafts exist for the lawyer, marked as drafts with [ ] placeholders", () => {
    for (const body of drafts) {
      expect(body).toContain("טיוטה לעורך דין — לא לפרסום כטקסט סופי");
      expect(body).toContain("[שם החברה]");
    }
    expect(draftHeadings.length).toBeGreaterThan(10);
  });

  it.each(["terms", "privacy"] as const)("/%s renders none of the draft", (kind) => {
    openFresh(`/${kind}`, <LegalScreen kind={kind} />);
    const page = document.body.textContent;
    expect(page).not.toContain("[");
    expect(page).not.toContain("טיוטה");
    for (const heading of draftHeadings) expect(screen.queryByRole("heading", { name: heading })).not.toBeInTheDocument();
  });

  it("no app source file holds the draft's text, so no route or build can render it", () => {
    function files(dir: string): string[] {
      return readdirSync(dir).flatMap((name) => {
        const full = path.join(dir, name);
        return statSync(full).isDirectory() ? files(full) : /\.(tsx?|css|html|json)$/.test(name) ? [full] : [];
      });
    }
    const self = path.join(repo, "app/src/screens/rare-screens-v2.test.tsx");
    for (const file of files(path.join(repo, "app/src")).filter((name) => name !== self)) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toContain("טיוטה לעורך דין");
      expect(source, file).not.toContain("[שם החברה]");
      for (const line of draftLines) expect(source.includes(line), `${file} holds a draft line`).toBe(false);
    }
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
