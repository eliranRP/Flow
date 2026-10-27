/**
 * FLOW-977: writes docs/legal/terms-draft.md and privacy-draft.md from app/src/legal-copy.ts, so the
 * lawyer reads exactly what the app shows. Run after changing the copy:
 *   node --experimental-strip-types scripts/legal-docs.mjs
 * legal-copy.test.ts fails when the docs and the copy differ.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const copy = await import(path.join(root, "app/src/legal-copy.ts"));

export function legalDoc(text, other) {
  return [
    `# ${text.title}`,
    "",
    `**${copy.LEGAL_DOC_MARK}**`,
    "",
    `> ${copy.LEGAL_DRAFT_LINE} הטקסט כאן זהה לטקסט שבאפליקציה (\`app/src/legal-copy.ts\`). סוגריים מרובעים [ ] הם פרטים להשלמה על ידי בעל העסק או עורך הדין. ראו גם [${other.title}](${other.file}).`,
    "",
    ...text.sections.flatMap((section) => [`## ${section.heading}`, "", ...section.paragraphs.flatMap((line) => [line, ""])]),
  ].join("\n");
}

writeFileSync(path.join(root, "docs/legal/terms-draft.md"), legalDoc(copy.TERMS, { title: copy.PRIVACY.title, file: "privacy-draft.md" }));
writeFileSync(path.join(root, "docs/legal/privacy-draft.md"), legalDoc(copy.PRIVACY, { title: copy.TERMS.title, file: "terms-draft.md" }));
