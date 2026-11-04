import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HELP_EMAIL } from "../config";
import { LEGAL, LEGAL_LINKS, LEGAL_UPDATED, PRIVACY } from "../legal-copy";
import type { NotificationPrefs, SubscribeOutcome } from "../push";
import { renderWithProviders } from "../test-render";

// FLOW-979 (decision 0225): the rare screens' review. חזרה from help and the legal pages, help's
// sign-in tips, the legal pages (full texts since decision 0252), and the push note's place.

let status: "anon" | "authed" | "loading" = "anon";
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

  it("while the session still loads: no sign-in tips yet", () => {
    status = "loading";
    openFresh("/help", <HelpScreen />);
    expect(screen.queryByText(SIGN_IN_TIPS[0])).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /@/ })).toBeInTheDocument();
  });
});

describe("the legal pages (decision 0252)", () => {
  const kinds = ["terms", "privacy", "cookies", "accessibility"] as const;

  it.each(kinds)("%s: the page title, the update date, every section heading and every line in the reading style", (kind) => {
    const text = LEGAL[kind];
    openFresh(`/${kind}`, <LegalScreen kind={kind} />);
    expect(screen.getByRole("heading", { level: 1, name: text.title })).toBeInTheDocument();
    expect(screen.getByText(LEGAL_UPDATED)).toBeInTheDocument();
    for (const section of text.sections) expect(screen.getByRole("heading", { level: 2, name: section.heading })).toBeInTheDocument();
    const lines = [...text.intro, ...text.sections.flatMap((section) => section.body.flatMap((block) => (typeof block === "string" ? [block] : block.list)))];
    for (const line of lines) expect(screen.getByText(line)).toHaveClass("t-body");
  });

  it.each(kinds)("%s: no placeholder, no draft mark, and the contact address", (kind) => {
    openFresh(`/${kind}`, <LegalScreen kind={kind} />);
    const page = document.body.textContent;
    expect(page).not.toMatch(/\[[^\]]*\]/);
    expect(page).not.toContain("טיוטה");
    if (kind !== "cookies") expect(page).toContain(HELP_EMAIL);
  });

  it("the privacy policy names every service the server sends data to", () => {
    const body = JSON.stringify(PRIVACY);
    for (const name of ["Supabase", "Cloudflare", "Google", "TypeSafe", "Resend", "Mercury", "SUMIT", "Apple"]) expect(body).toContain(name);
  });

  it.each([
    ["terms", "anon", "sign-in page"],
    ["privacy", "anon", "sign-in page"],
    ["cookies", "anon", "sign-in page"],
    ["accessibility", "anon", "sign-in page"],
    ["terms", "authed", "home page"],
    ["privacy", "authed", "home page"],
  ] as const)("%s, %s: חזרה goes to the %s", (kind, who, target) => {
    status = who;
    openFresh(`/${kind}`, <LegalScreen kind={kind} />);
    fireEvent.click(screen.getByRole("button", { name: "חזרה" }));
    expect(screen.getByText(target)).toBeInTheDocument();
  });

  it("every legal link points at a page", () => {
    expect(LEGAL_LINKS.map((link) => link.to)).toEqual(kinds.map((kind) => `/${kind}`));
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
