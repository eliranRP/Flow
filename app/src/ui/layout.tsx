import type { ReactNode } from "react";
import { FocusTitle } from "./focus-title";
import { Button } from "./button";

export function FormError({ children }: { children: ReactNode }) {
  return (
    <p className="ui-form-error" role="alert" dir="rtl">
      {children}
    </p>
  );
}

export function FigureLine({ label, value }: { label: string; value: string }) {
  return (
    <p className="ui-figure">
      <span>{label}</span> <bdi dir="ltr">{value}</bdi>
    </p>
  );
}

/** Shown only when a category line includes this project's share of a shared cost. */
export function SharedCostNote() {
  return <p className="ui-page-pad ui-shared-note t-caption t-muted">כולל חלק מהוצאות משותפות</p>;
}

export function SectionHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="ui-section-head">
      <h2 className="t-sheet">{title}</h2>
      {children}
    </div>
  );
}

export function SignInFrame({ children }: { children: ReactNode }) {
  return <main className="ui-signin">{children}</main>;
}

export function SignInBrand({ children }: { children: ReactNode }) {
  return <div className="ui-signin-brand">{children}</div>;
}

export function SignInTagline({ children }: { children: ReactNode }) {
  return <p className="ui-signin-tagline">{children}</p>;
}

export function SignInPanel({ children }: { children: ReactNode }) {
  return <section className="ui-signin-sheet">{children}</section>;
}

export function SignInHeading({ children }: { children: ReactNode }) {
  return <FocusTitle className="t-title ui-signin-heading">{children}</FocusTitle>;
}

export function SignInActions({ children }: { children: ReactNode }) {
  return <div className="ui-signin-button">{children}</div>;
}

export function SignInPrivacy({ children }: { children: ReactNode }) {
  return <p className="ui-signin-privacy t-caption t-muted">{children}</p>;
}

export function HelpMail({ email }: { email: string }) {
  return (
    <p className="ui-page-pad mt-4">
      <Button variant="link" href={`mailto:${email}`}>
        {email}
      </Button>
    </p>
  );
}

