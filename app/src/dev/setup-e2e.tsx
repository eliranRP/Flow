import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SessionProviders } from "../session-providers";
import { BooksProvider } from "../use-books";
import { useParams } from "react-router-dom";
import { SetupWelcome } from "../setup/welcome";
import { SkipSheet } from "../setup/skip-sheet";
import { SetupDone, type DoneRow } from "../setup/done";
import { StepBusiness, StepConnect, StepInstall, StepJev, StepLoans, StepProjects, StepReview, type StepProps } from "../setup/steps";
import type { SetupLender } from "../setup/storage";

/** Dev-only e2e fixtures for the onboarding proofs: the same components the Storybook stories draw, with invented data and no session. */
const noop: StepProps = {
  onDone: () => undefined,
  onStamp: () => undefined,
  onSkipStep: () => undefined,
  onSkipAll: () => undefined,
  onBack: () => undefined,
};

/** What the bank lines suggest in steps 3 and 4: invented names, read from the query cache so no session is needed. */
const SUGGESTIONS = {
  projects: ["Birch Lane", "Elm Row", "Juniper Ct", "Sable Ct"],
  lenders: [
    { name: "Harbor Lending", monthly_agorot: 310_000, since: "2024-03-01" },
    { name: "Juniper Credit", monthly_agorot: 180_000, since: "2025-01-01" },
  ] satisfies SetupLender[],
};
const PICKED_LENDER: SetupLender = { name: "Lakeview Mortgage", monthly_agorot: 524_000, since: "2010-07-01" };
const COMPANY = "c-fixture";

/** Step 3 with one suggestion already added, as the board shows it: the fixture taps the first suggestion once. */
function ProjectsWithOneAdded() {
  const tapped = useRef(false);
  useEffect(() => {
    if (tapped.current) return;
    tapped.current = true;
    document.querySelector<HTMLButtonElement>(".ui-onb-chip-suggest")?.click();
  }, []);
  return <StepProjects {...noop} companyId={COMPANY} bankConnected existingNames={[]} />;
}

/** Step 7 as the board draws it: the app is already open from the home screen, so there are no install steps to show. */
function InstalledInstall() {
  useState(() => {
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    return null;
  });
  return <StepInstall {...noop} />;
}

const DONE_ROWS: DoneRow[] = [
  { label: "העסק", value: "Ridgeline Homes", done: true, delay: 0 },
  { label: "Mercury", value: "מחובר", done: true, delay: 60 },
  { label: "SUMIT", value: "דילגתם", done: false, delay: 120 },
  { label: "פרויקטים", value: "3", done: true, delay: 180 },
  { label: "הלוואות", value: "2 להשלמה", done: true, delay: 240 },
  { label: "תיוג חכם", value: "פעיל", done: true, delay: 300 },
  { label: "מסך הבית", value: "מוכן", done: true, delay: 360 },
];

/** The app's router already wraps this route, so the fixture adds the app's providers and query client, with the company currency the story uses, and no second router. */
function FixtureFrame({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const next = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    next.setQueryData(["company-currency", "off"], "ILS");
    next.setQueryData(["setup-suggestions", COMPANY], SUGGESTIONS);
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
  if (frame === "business") {
    return (
      <FixtureFrame>
        <StepBusiness {...noop} onBack={undefined} companyId={null} initial={null} />
      </FixtureFrame>
    );
  }
  if (frame === "skip") {
    return (
      <FixtureFrame>
        <StepConnect {...noop} mercuryConnected={false} sumitConnected={false} />
        <SkipSheet open onOpenChange={() => undefined} onConfirm={() => undefined} />
      </FixtureFrame>
    );
  }
  if (frame === "projects") {
    return <FixtureFrame><ProjectsWithOneAdded /></FixtureFrame>;
  }
  if (frame === "loans") {
    return (
      <FixtureFrame>
        <StepLoans {...noop} companyId={COMPANY} currency="USD" bankConnected picks={[PICKED_LENDER]} loanCount={0} onPick={() => undefined} />
      </FixtureFrame>
    );
  }
  if (frame === "jev") return <FixtureFrame><StepJev {...noop} /></FixtureFrame>;
  if (frame === "review") return <FixtureFrame><StepReview {...noop} approved={false} /></FixtureFrame>;
  if (frame === "install") return <FixtureFrame><InstalledInstall /></FixtureFrame>;
  if (frame === "done") return <FixtureFrame><SetupDone rows={DONE_ROWS} onHome={() => undefined} /></FixtureFrame>;
  return (
    <FixtureFrame>
      <StepConnect {...noop} mercuryConnected={false} sumitConnected={false} />
    </FixtureFrame>
  );
}
