import type { ReactNode } from "react";
import { TextLink } from "./text-link";

export function BandHero({ children }: { children: ReactNode }) {
  return <div className="band-hero">{children}</div>;
}

export function SectionHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="section-head">
      <h2 className="t-title-3">{title}</h2>
      {children}
    </div>
  );
}

export function SignInFrame({ children }: { children: ReactNode }) {
  return <main className="signin">{children}</main>;
}

export function SignInBrand({ children }: { children: ReactNode }) {
  return <div className="signin-brand">{children}</div>;
}

export function SignInTagline({ children }: { children: ReactNode }) {
  return <p className="signin-tagline">{children}</p>;
}

export function SignInPanel({ children }: { children: ReactNode }) {
  return <section className="signin-sheet">{children}</section>;
}

export function SignInHeading({ children }: { children: ReactNode }) {
  return <h1 className="t-title-2 signin-heading">{children}</h1>;
}

export function SignInActions({ children }: { children: ReactNode }) {
  return <div className="signin-button">{children}</div>;
}

export function SignInHelp({ children }: { children: ReactNode }) {
  return <p className="signin-help">{children}</p>;
}

export function SignInPrivacy({ children }: { children: ReactNode }) {
  return <p className="signin-privacy t-hint">{children}</p>;
}

export function HelpMail({ email }: { email: string }) {
  return (
    <p className="mt-4">
      <TextLink className="help-mail t-label text-accent-text underline" href={`mailto:${email}`}>
        {email}
      </TextLink>
    </p>
  );
}

export function HelpBack({ to = "/sign-in" }: { to?: string }) {
  return (
    <TextLink to={to} className="help-back t-label">
      חזרה
    </TextLink>
  );
}
