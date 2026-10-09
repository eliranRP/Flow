import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NO_PREFS, type NotificationPrefs, type PushSupport } from "../push";
import { PUSH_QUESTION, ReviewPushPrompt } from "../screens/review-push-prompt";
import { ToastProvider } from "../ui/toast";
import { StepInstall } from "./steps";

// FLOW-502: setup step 5 offers the review card's evening reminder, asked once across both places.

const server = vi.hoisted(() => ({
  prefs: { new_transaction: false, evening_reminder: false, weekly_summary: false, prompt_answered: false, has_subscription: false },
  calls: [] as Array<{ name: string; args?: unknown }>,
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: { p_yes?: boolean }) => {
      server.calls.push({ name, args });
      if (name === "answer_push_prompt") server.prefs = { ...server.prefs, prompt_answered: true, evening_reminder: args?.p_yes === true };
      return Promise.resolve({ data: { ...server.prefs }, error: null });
    },
  }),
}));

function wrap(ui: ReactNode, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/setup/5"]}>{ui}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function step(pushSample?: { prefs: NotificationPrefs; support: PushSupport }, mode: "android-steps" | "iphone" = "android-steps") {
  return <StepInstall initialMode={mode} pushSample={pushSample} onSkip={() => undefined} onFinish={() => undefined} />;
}

beforeEach(() => {
  server.prefs = { ...NO_PREFS };
  server.calls = [];
});

describe("setup step 5 reminder card", () => {
  it("asks under the install steps, and לא עכשיו hands focus to the step's own button", () => {
    wrap(step({ prefs: NO_PREFS, support: "ok" }));
    expect(screen.getByText(PUSH_QUESTION)).toBeInTheDocument();
    screen.getByRole("button", { name: "לא עכשיו" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "לא עכשיו" }));
    expect(screen.queryByText(PUSH_QUESTION)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "סיום" })).toHaveFocus();
  });

  it("sits above the install demo and steps, so its answers clear the pinned סיום (FLOW-353)", () => {
    const { container } = wrap(step({ prefs: NO_PREFS, support: "ok" }));
    const card = container.querySelector(".ui-prompt-card");
    const steps = container.querySelector(".ui-install-steps");
    const demo = container.querySelector(".ui-setup-stage-host");
    expect(card).not.toBeNull();
    for (const after of [steps, demo]) {
      expect(after).not.toBeNull();
      if (card && after) expect(card.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("is not asked once answered, when the reminder is on, where push can't work, or on an iPhone tab", () => {
    const cases: Array<{ prefs: NotificationPrefs; support: PushSupport }> = [
      { prefs: { ...NO_PREFS, prompt_answered: true }, support: "ok" },
      { prefs: { ...NO_PREFS, evening_reminder: true, has_subscription: true }, support: "ok" },
      { prefs: NO_PREFS, support: "unsupported" },
      { prefs: NO_PREFS, support: "not-configured" },
      // The step itself teaches the Home Screen; the card asks again from the installed app.
      { prefs: NO_PREFS, support: "ios-home-screen" },
    ];
    for (const sample of cases) {
      const { unmount } = wrap(step(sample, "iphone"));
      expect(screen.queryByText(PUSH_QUESTION)).not.toBeInTheDocument();
      unmount();
    }
  });

  it("the review card still shows the Home Screen note on an iPhone tab", () => {
    wrap(<ReviewPushPrompt sample={NO_PREFS} support="ios-home-screen" />);
    fireEvent.click(screen.getByRole("button", { name: "כן" }));
    expect(screen.getByRole("link", { name: "למסך הבית" })).toBeInTheDocument();
  });

  it("shares the asked-once answer with the review card, in this session and from the server", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Step 5's card, live (jsdom has no VAPID key, so support is passed the way a phone would read it).
    const setup = wrap(<ReviewPushPrompt support="ok" focusAfter={() => undefined} iphoneTab="hide" />, client);
    expect(await screen.findByText(PUSH_QUESTION)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "לא עכשיו" }));
    await waitFor(() => { expect(server.calls.find((call) => call.name === "answer_push_prompt")?.args).toEqual({ p_yes: false }); });
    setup.unmount();

    // The review card in the same session reads the cached answer.
    const review = wrap(<ReviewPushPrompt support="ok" />, client);
    expect(screen.queryByText(PUSH_QUESTION)).not.toBeInTheDocument();
    review.unmount();

    // A later visit reads it from the server.
    const reads = server.calls.length;
    wrap(<ReviewPushPrompt support="ok" />);
    await waitFor(() => { expect(server.calls.slice(reads).some((call) => call.name === "get_notification_prefs")).toBe(true); });
    expect(screen.queryByText(PUSH_QUESTION)).not.toBeInTheDocument();
  });
});
