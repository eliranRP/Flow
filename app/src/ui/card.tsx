import type { ReactNode } from "react";

export function Card({ children }: { children: ReactNode }) {
  return <section className="ui-card">{children}</section>;
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ui-section">
      <h2 className="ui-section-title">{title}</h2>
      {children}
    </section>
  );
}
