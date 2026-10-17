import type { CSSProperties, ReactNode } from "react";
import { ROLE_LABEL, type MyInvite } from "../team-api";
import { CheckIcon, CloseIcon } from "../ui/icons";

/** What each role can and cannot do, in the board's words (Invite.dc.html). */
const ROLE_COPY = {
  viewer: {
    name: "צופה",
    can: ["רואה את הבית, הפרויקטים, הרווח והתחזית", "רואה תנועות, חשבוניות והלוואות"],
    cannot: ["לא מאשר, לא משייך ולא משנה כלום"],
  },
  editor: {
    name: "עורך",
    can: ["רואה הכל", "מאשר תנועות, משייך לפרויקטים ולקטגוריות", "מוסיף קבלות, תנועות במזומן והלוואות"],
    cannot: ["לא משנה את הגדרות העסק, החיבורים או הצוות"],
  },
} as const;

export function roleName(role: MyInvite["role"]): string {
  return ROLE_COPY[role].name;
}

export function inviterName(invite: MyInvite): string {
  return invite.invited_by_name?.trim() || "בעל העסק";
}

/** dd/mm/yyyy, or dd/mm without the year. */
export function inviteDate(iso: string, withYear = true): string {
  const date = new Date(iso);
  const year = String(date.getFullYear());
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return withYear ? `${day}/${month}/${year}` : `${day}/${month}`;
}

/** One block that rises in, one stagger step after the one before. */
export function Rise({ step, className, children }: { step: number; className?: string; children: ReactNode }) {
  return (
    <div className={`invite-rise${className ? ` ${className}` : ""}`} style={{ "--step": step } as CSSProperties}>
      {children}
    </div>
  );
}

export function RoleCard({ role }: { role: MyInvite["role"] }) {
  const copy = ROLE_COPY[role];
  return (
    <section className="invite-card invite-role-card">
      <div className="invite-role-head">
        <span className="invite-role-name">{copy.name}</span>
        <span className="invite-muted">התפקיד שלך</span>
      </div>
      {copy.can.map((line) => (
        <div key={line} className="invite-role-line">
          <span className="invite-icon invite-can"><CheckIcon size={16} /></span>
          <span>{line}</span>
        </div>
      ))}
      {copy.cannot.map((line) => (
        <div key={line} className="invite-role-line invite-cannot">
          <span className="invite-icon"><CloseIcon size={16} stroke={2.4} /></span>
          <span>{line}</span>
        </div>
      ))}
    </section>
  );
}

export function FactsCard({ invite }: { invite: MyInvite }) {
  const by = invite.invited_by_role ? `${inviterName(invite)} · ${ROLE_LABEL[invite.invited_by_role]}` : inviterName(invite);
  return (
    <section className="invite-card invite-facts">
      <div className="invite-fact"><span className="invite-fact-key">הוזמנת על ידי</span><span>{by}</span></div>
      {invite.email ? (
        <div className="invite-fact"><span className="invite-fact-key">לכתובת</span><bdi dir="ltr">{invite.email}</bdi></div>
      ) : null}
      {invite.expires_at ? (
        <div className="invite-fact"><span className="invite-fact-key">בתוקף עד</span><span>{inviteDate(invite.expires_at)}</span></div>
      ) : null}
    </section>
  );
}
