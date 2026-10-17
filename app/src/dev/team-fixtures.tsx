import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { cashMonthKey } from "../cash";
import { attentionRows, CashHome } from "../screens/HomeScreen";
import { CompanySwitcher } from "../screens/company-switcher";
import { InvitesScreen } from "../screens/invites-screen";
import { TeamScreen } from "../screens/team-screen";
import { TeamApiProvider } from "../team-api";
import { sampleCashMonths } from "./cash-sample";
import { createSampleTeamApi, type SampleTeamOptions } from "./team-sample";

/**
 * Dev-only fixtures for FLOW-601 (the design review opens these): the team page, the invites
 * list and Home's חברה sheet, on an in-memory team. Invented names and example.com only.
 */

function SampleTeam({ options, children }: { options: SampleTeamOptions; children: ReactNode }) {
  const [api] = useState(() => createSampleTeamApi({ delayMs: 400, ...options }));
  return (
    <TeamApiProvider api={api}>{children}</TeamApiProvider>
  );
}

/** Dev-only: `?email=1` types the board's example address into the open invite sheet, as a reviewer would. */
function fillInviteEmail() {
  const started = Date.now();
  const timer = window.setInterval(() => {
    const field = document.querySelector<HTMLInputElement>('[role="dialog"] input[type="email"], [role="dialog"] input');
    if (field) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, "partner@example.com");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      window.clearInterval(timer);
    } else if (Date.now() - started > 4000) {
      window.clearInterval(timer);
    }
  }, 100);
}

/** Dev-only: `?sheet=invite` presses the page's invite button once the list is in, so a proof captures the open sheet. */
function OpenInviteSheet() {
  const [params] = useSearchParams();
  useEffect(() => {
    if (params.get("sheet") !== "invite") return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const button = [...document.querySelectorAll("button")].find((el) => el.textContent.includes("הזמנה לצוות"));
      if (button) {
        button.click();
        window.clearInterval(timer);
        if (params.get("email") === "1") fillInviteEmail();
      } else if (Date.now() - started > 4000) {
        window.clearInterval(timer);
      }
    }, 100);
    return () => { window.clearInterval(timer); };
  }, [params]);
  return null;
}

/** `/e2e/team?team=` pending (invite-2), alone, editor, loading, error, or nothing for a-1. `&board=1` is the board's rows. */
export function DevTeam() {
  const [params] = useSearchParams();
  const state = params.get("team");
  // FLOW-512 proof: ?proof=1 answers at once, so a board capture is not taken on the loading skeleton.
  const options: SampleTeamOptions = {
    ...(params.get("proof") === "1" ? { delayMs: 0 } : {}),
    pendingInvite: state === "pending",
    alone: state === "alone",
    boardRows: params.get("board") === "1",
    role: state === "editor" ? "editor" : "owner",
    hold: state === "loading" ? ["listTeam"] : undefined,
    fail: state === "error" ? { listTeam: "Failed to fetch" } : state === "full" ? { inviteMember: "too many invites" } : undefined,
  };
  return (
    <SampleTeam key={state} options={options}>
      <OpenInviteSheet />
      <TeamScreen />
    </SampleTeam>
  );
}

/** `/e2e/invites?inbox=` 1, empty, loading, error, late (ביטול after ten minutes), or nothing for two (invite-3). */
export function DevInvites() {
  const [params] = useSearchParams();
  const state = params.get("inbox");
  const options: SampleTeamOptions = {
    noCompany: true,
    inbox: state === "1" ? 1 : state === "empty" ? 0 : 2,
    hold: state === "loading" ? ["myInvites"] : undefined,
    fail: state === "error" ? { myInvites: "Failed to fetch" } : state === "late" ? { reopenInvite: "invite is not declined" } : undefined,
  };
  return (
    <SampleTeam key={state} options={options}>
      <InvitesScreen />
    </SampleTeam>
  );
}


/**
 * `/e2e/company?company=` invite (invite-4), viewer, error, or nothing for two companies (a-3). Tap the name.
 * Home is the cash view (FLOW-413): the name sits on its band.
 */
export function DevCompany() {
  const [params] = useSearchParams();
  const state = params.get("company");
  const options: SampleTeamOptions = {
    twoCompanies: state !== "invite",
    inbox: state === "invite" ? 1 : 0,
    role: state === "viewer" ? "viewer" : "owner",
    fail: state === "error" ? { switchCompany: "Failed to fetch" } : undefined,
  };
  const cash = sampleCashMonths();
  const currentKey = cashMonthKey(cash.months[0]?.month ?? "");
  return (
    <SampleTeam key={state} options={options}>
      <CashHome
        data={cash}
        monthKey={currentKey}
        currentKey={currentKey}
        previewing={false}
        search=""
        attention={attentionRows({ pending: 7, unpaidCount: 3, unpaidGross: 460_000n, missingCount: 0, search: "" })}
        company={<CompanySwitcher />}
        onStepMonth={() => undefined}
      />
    </SampleTeam>
  );
}
