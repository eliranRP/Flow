import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { SessionProviders } from "../session-providers";
import { BooksProvider } from "../use-books";
import { useParams } from "react-router-dom";
import { SetupWelcome } from "../setup/welcome";
import { SkipSheet } from "../setup/skip-sheet";
import { StepConnect, type StepProps } from "../setup/steps";

/** Dev-only e2e fixtures for the onboarding proofs: the same components the Storybook stories draw, with invented data and no session. */
const noop: StepProps = {
  onDone: () => undefined,
  onStamp: () => undefined,
  onSkipStep: () => undefined,
  onSkipAll: () => undefined,
  onBack: () => undefined,
};

/** The app's router already wraps this route, so the fixture adds the app's providers and query client, with the company currency the story uses, and no second router. */
function FixtureFrame({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const next = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    next.setQueryData(["company-currency", "off"], "ILS");
    return next;
  });
  return (
    <QueryClientProvider client={client}>
      <SessionProviders>
        <BooksProvider>
          <div className="flex min-h-dvh w-full min-w-0 flex-col">{children}</div>
        </BooksProvider>
      </SessionProviders>
    </QueryClientProvider>
  );
}

export function DevSetupFrame() {
  const { frame = "connect" } = useParams();
  if (frame === "welcome") {
    return <SetupWelcome onStart={() => undefined} onSkipAll={() => undefined} />;
  }
  if (frame === "skip") {
    return (
      <FixtureFrame>
        <StepConnect {...noop} mercuryConnected={false} sumitConnected={false} />
        <SkipSheet open onOpenChange={() => undefined} onConfirm={() => undefined} />
      </FixtureFrame>
    );
  }
  return (
    <FixtureFrame>
      <StepConnect {...noop} mercuryConnected={false} sumitConnected={false} />
    </FixtureFrame>
  );
}
