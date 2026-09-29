import type { ReactNode } from "react";
import { useGoBack } from "./back";
import { FocusTitle } from "./focus-title";
import { TextLink } from "./text-link";

export function BandHero({ children }: { children: ReactNode }) {
  return <div className="ui-band-hero">{children}</div>;
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ui-page-pad ui-stack">
      <h2 className="t-title-3">{title}</h2>
      {children}
    </section>
  );
}

export function BandFigures({ income, expense }: { income: string; expense: string }) {
  return (
    <div className="ui-band-figures">
      <span>
        הכנסות <bdi dir="ltr">{income}</bdi>
      </span>
      <span>
        הוצאות <bdi dir="ltr">{expense}</bdi>
      </span>
    </div>
  );
}

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

export function SectionHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="ui-section-head">
      <h2 className="t-title-3">{title}</h2>
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
  return <FocusTitle className="t-title-2 ui-signin-heading">{children}</FocusTitle>;
}

export function SignInActions({ children }: { children: ReactNode }) {
  return <div className="ui-signin-button">{children}</div>;
}

export function SignInHelp({ children }: { children: ReactNode }) {
  return <p className="ui-signin-help">{children}</p>;
}

export function SignInPrivacy({ children }: { children: ReactNode }) {
  return <p className="ui-signin-privacy t-hint">{children}</p>;
}

export function HelpMail({ email }: { email: string }) {
  return (
    <p className="ui-page-pad mt-4">
      <TextLink href={`mailto:${email}`} chevron={false}>
        {email}
      </TextLink>
    </p>
  );
}

export function HelpBack({ to = "/sign-in" }: { to?: string }) {
  const goBack = useGoBack();
  return (
    <p className="ui-page-pad">
      <TextLink
        tone="quiet"
        chevron={false}
        onClick={() => {
          goBack(to);
        }}
      >
        חזרה
      </TextLink>
    </p>
  );
}
