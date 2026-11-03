import { useRef, useState } from "react";
import { useSheetHistory } from "../ui/back";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { InfoIcon } from "../ui/icons";
import { Sheet } from "../ui/sheet";
import { LEARN, LEARN_TITLES, englishName, type LearnKey } from "./project-returns-learn";

/* ------------------------------------------------------------------------------------------------
 * FLOW-462: the ⓘ beside a returns page's title. It opens the ⓘ sheet with how an investor reads
 * the figure: what it is, how to read it, and what it is for. Focus returns to the ⓘ on close.
 * ---------------------------------------------------------------------------------------------- */

const PARTS = ["what", "read", "goal"] as const;

export function LearnButton({ learnKey, title, initialOpen = false }: { learnKey: LearnKey; title: string; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const opener = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null);
  const setSheet = useSheetHistory(`returns-learn-${learnKey}`, open, setOpen);
  return (
    <>
      <IconButton ref={opener} label={`איך לקרוא את ${title}`} className="ui-ret-info-btn ui-ret-learn-btn" onClick={() => { setSheet(true); }}>
        <InfoIcon size={18} />
      </IconButton>
      <Sheet
        open={open}
        onOpenChange={setSheet}
        title={title}
        subtitle={englishName(learnKey)}
        closeButton={false}
        returnFocusRef={opener}
        panelClassName="ui-sheet-wide ui-sheet-g10 ui-ret-info"
        action={<Button variant="secondary" full onClick={() => { setSheet(false); }}>סגירה</Button>}
      >
        <LearnSections learnKey={learnKey} />
      </Sheet>
    </>
  );
}

/** What it is, how to read it, what it is for: the ⓘ sheet's body, and the end of a figure's ⓘ sheet. */
export function LearnSections({ learnKey }: { learnKey: LearnKey }) {
  const learn = LEARN[learnKey];
  return (
    <>
      {PARTS.map((part) => (
        <section key={part} className="ui-ret-learn" aria-label={LEARN_TITLES[part]}>
          <h3 className="t-section">{LEARN_TITLES[part]}</h3>
          <p className="ui-pinv-help">{learn[part]}</p>
        </section>
      ))}
    </>
  );
}
