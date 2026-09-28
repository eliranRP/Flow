import { useState, type ReactNode } from "react";
import { BandHero, SectionHead } from "../ui/layout";
import { PeriodPicker } from "../ui/period-picker";
import { Skeleton } from "../ui/skeleton";
import { TopBand } from "../ui/top-band";

const rowKeys = ["a", "b", "c"] as const;

/** ld-01. A live load hides the preview label. Preview loading keeps מצב תצוגה (0044). */
export function HomeSkeleton({ preview = false, example }: { preview?: boolean; example?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-full min-w-0 flex-1 flex-col" aria-busy="true">
      <p className="sr-only" role="status">
        טוען…
      </p>
      <TopBand
        preview={preview}
        example={example}
        trailing={
          <PeriodPicker
            pill="החודש"
            open={open}
            onOpenChange={setOpen}
            options={[
              { label: "החודש", hint: "התקופה הנוכחית", selected: true, onSelect: () => { setOpen(false); } },
              { label: "חודש קודם", onSelect: () => { setOpen(false); } },
              { label: "מתחילת השנה", onSelect: () => { setOpen(false); } },
            ]}
          />
        }
      >
        <div className="ui-skel-band">
          <span className="ui-greet">
            <Skeleton tone="band" className="ui-skel-greet-a" />
            <Skeleton tone="band" className="ui-skel-greet-b" />
          </span>
          <BandHero>
            <Skeleton tone="band" className="ui-skel-label" />
            <Skeleton tone="band" className="ui-skeleton-hero ui-skel-hero-num" />
            <span className="ui-skel-delta">
              <Skeleton tone="band" className="ui-skel-delta-a" />
              <Skeleton tone="band" className="ui-skel-delta-b" />
            </span>
          </BandHero>
          <span className="ui-skel-figures">
            <Skeleton tone="band" className="ui-skel-figure" />
            <Skeleton tone="band" className="ui-skel-figure" />
          </span>
        </div>
      </TopBand>
      <div className="ui-skel-card">
        <Skeleton className="ui-skel-dot" />
        <span className="ui-skel-copy">
          <Skeleton width="lg" />
          <Skeleton width="md" />
        </span>
      </div>
      <SectionHead title="פרויקטים מובילים" />
      <div className="ui-project-list">
        {rowKeys.map((key) => (
          <div className="ui-row" key={key}>
            <span className="ui-skel-copy">
              <Skeleton width="md" />
              <Skeleton width="sm" />
            </span>
            <Skeleton width="sm" />
          </div>
        ))}
      </div>
    </div>
  );
}
