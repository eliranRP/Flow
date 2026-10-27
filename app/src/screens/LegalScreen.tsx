import { PRIVACY, TERMS } from "../legal-copy";
import { ScreenHeader } from "../ui/screen-header";
import { usePublicBackTarget } from "./public-back";
import "../ui/css/60-help-legal.css";

/**
 * FLOW-977 (decision 0225): terms and privacy. The title is the page's own title; the body reads at
 * 17px on 1.5. The copy loads with this lazy screen, not with the app's entry.
 */
export function LegalScreen({ kind }: { kind: "terms" | "privacy" }) {
  const back = usePublicBackTarget();
  const text = kind === "terms" ? TERMS : PRIVACY;
  return (
    <main className="safe-bottom min-h-dvh">
      <ScreenHeader title={text.title} backTo={back} />
      <article className="ui-page-pad ui-legal">
        {text.paragraphs.map((line) => <p key={line} className="t-body">{line}</p>)}
      </article>
    </main>
  );
}
