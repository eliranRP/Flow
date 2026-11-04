import "../ui/lazy.css";
import { Fragment, type MouseEvent } from "react";
import { HELP_EMAIL } from "../config";
import { LEGAL, LEGAL_UPDATED, type LegalBlock, type LegalKind } from "../legal-copy";
import { Button } from "../ui/button";
import { ScreenHeader } from "../ui/screen-header";
import { usePublicBackTarget } from "./public-back";
import "../ui/css/60-help-legal.css";

/** FLOW-520: a page with this many sections or more opens with a "בעמוד הזה" list of jump links. */
const JUMP_LIST_FROM = 5;

/**
 * FLOW-520: the contact address in a line is a mailto link, isolated left to right, with the
 * sentence's punctuation outside it. The words themselves stay as written in legal-copy.ts.
 */
function Line({ text }: { text: string }) {
  const parts = text.split(HELP_EMAIL);
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <bdi dir="ltr">
              <Button variant="link" href={`mailto:${HELP_EMAIL}`} className="ui-btn-link-inline ui-legal-mail">
                {HELP_EMAIL}
              </Button>
            </bdi>
          ) : null}
          {part}
        </Fragment>
      ))}
    </>
  );
}

function Block({ block }: { block: LegalBlock }) {
  if (typeof block === "string") return <p className="t-body"><Line text={block} /></p>;
  return (
    <ul className="ui-legal-list">
      {block.list.map((item) => <li key={item} className="t-body"><Line text={item} /></li>)}
    </ul>
  );
}

/** The section's id: the page's kind and its place, so the jump links stay stable while the words change. */
function sectionId(kind: LegalKind, index: number): string {
  return `${kind}-${String(index + 1)}`;
}

/** A jump link scrolls to its section and moves focus to the heading, so a screen reader goes on from there. */
function jump(event: MouseEvent<HTMLAnchorElement>, id: string) {
  const heading = document.getElementById(id);
  if (heading == null) return;
  event.preventDefault();
  heading.scrollIntoView({ block: "start" });
  heading.focus({ preventScroll: true });
}

/**
 * Decision 0252 (was 0225): terms, privacy, cookies and storage, and the accessibility statement.
 * The title is the page's own title; the body reads at 17px on 1.5. The copy loads with this lazy
 * screen, not with the app's entry.
 */
export function LegalScreen({ kind }: { kind: LegalKind }) {
  const back = usePublicBackTarget();
  const text = LEGAL[kind];
  const jumpList = text.sections.length >= JUMP_LIST_FROM;
  return (
    <main className="safe-bottom min-h-dvh">
      <ScreenHeader title={text.title} backTo={back} />
      <article className="ui-page-pad ui-legal">
        <p className="t-caption t-muted">עודכן לאחרונה: <bdi dir="ltr">{LEGAL_UPDATED}</bdi></p>
        {jumpList ? (
          <nav className="ui-legal-toc" aria-labelledby={`${kind}-toc`}>
            <h2 id={`${kind}-toc`} className="t-caption t-muted">בעמוד הזה</h2>
            <ul>
              {text.sections.map((section, i) => (
                <li key={section.heading}>
                  <a href={`#${sectionId(kind, i)}`} className="t-line2" onClick={(event) => { jump(event, sectionId(kind, i)); }}>
                    {section.heading}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        {text.intro.map((line) => <p key={line} className="t-body"><Line text={line} /></p>)}
        {text.sections.map((section, i) => (
          <section key={section.heading} className="ui-legal-section">
            <h2 id={sectionId(kind, i)} tabIndex={-1} className="ui-legal-heading">{section.heading}</h2>
            {section.body.map((block, j) => <Block key={j} block={block} />)}
          </section>
        ))}
      </article>
    </main>
  );
}
