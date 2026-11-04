import "../ui/lazy.css";
import { LEGAL, LEGAL_UPDATED, type LegalBlock, type LegalKind } from "../legal-copy";
import { ScreenHeader } from "../ui/screen-header";
import { usePublicBackTarget } from "./public-back";
import "../ui/css/60-help-legal.css";

function Block({ block }: { block: LegalBlock }) {
  if (typeof block === "string") return <p className="t-body">{block}</p>;
  return (
    <ul className="ui-legal-list">
      {block.list.map((item) => <li key={item} className="t-body">{item}</li>)}
    </ul>
  );
}

/**
 * Decision 0252 (was 0225): terms, privacy, cookies and storage, and the accessibility statement.
 * The title is the page's own title; the body reads at 17px on 1.5. The copy loads with this lazy
 * screen, not with the app's entry.
 */
export function LegalScreen({ kind }: { kind: LegalKind }) {
  const back = usePublicBackTarget();
  const text = LEGAL[kind];
  return (
    <main className="safe-bottom min-h-dvh">
      <ScreenHeader title={text.title} backTo={back} />
      <article className="ui-page-pad ui-legal">
        <p className="t-caption t-muted">עודכן לאחרונה: <bdi dir="ltr">{LEGAL_UPDATED}</bdi></p>
        {text.intro.map((line) => <p key={line} className="t-body">{line}</p>)}
        {text.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="ui-legal-heading">{section.heading}</h2>
            {section.body.map((block, i) => <Block key={i} block={block} />)}
          </section>
        ))}
      </article>
    </main>
  );
}
