import type { ReactNode } from "react";
import { usePreviewSearch } from "../preview";
import { israelToday } from "../ui/date-math";
import { HomeBandActions, homeMonthLabel } from "./home-parts";
import { DelayedSkeleton, Skeleton } from "../ui/skeleton";
import { TopBand } from "../ui/top-band";

/** FLOW-375 (board, States homeLoading): a skeleton row of the attention box and the third block: an icon slot, copy, a trailing bar. */
function CashSkeletonRow() {
  return (
    <div className="ui-skel-row">
      <Skeleton className="ui-skel-row-dot" />
      <span className="ui-skel-copy">
        <Skeleton className="ui-skel-line-a" />
        <Skeleton className="ui-skel-line-b" />
      </span>
      <Skeleton className="ui-skel-row-trail" />
    </div>
  );
}

/**
 * FLOW-364 / FLOW-375: Home's cash while it loads, in the shape it lands in: the band (the company, the icons
 * and the month pill are real; the figures are band bars), the split card and the attention box at the loaded
 * Home's geometry, then the board's third block (a title and three rows). A known `company` shows its name and
 * initial in the band, as the board's loading frame does, in place of the label bar.
 */
export function CashHomeSkeleton({ preview = false, example, company }: { preview?: boolean; example?: ReactNode; company?: string }) {
  const search = usePreviewSearch();
  const currentKey = israelToday().slice(0, 7);
  return (
    <div className="flex min-h-full min-w-0 flex-1 flex-col" aria-busy="true">
      <DelayedSkeleton>
        <p className="sr-only" role="status">
          טוען…
        </p>
      </DelayedSkeleton>
      <TopBand
        wordmark={false}
        preview={preview}
        example={example}
        leading={
          company != null ? (
            <span className="ui-band-company">
              <span className="ui-band-company-name">{company}</span>
            </span>
          ) : (
            <DelayedSkeleton>
              <Skeleton tone="band" className="ui-skel-label" />
            </DelayedSkeleton>
          )
        }
        trailing={<HomeBandActions isPast={false} currentName="" search={search} avatarInitial={company?.slice(0, 1) ?? ""} />}
      >
        <div className="ui-band-body">
          <p className="ui-band-month-static">{homeMonthLabel(currentKey)}</p>
          <DelayedSkeleton>
            <div className="ui-home-figures ui-skel-band-figs" aria-hidden="true">
              <Skeleton tone="band" className="ui-skel-band-label" />
              <Skeleton tone="band" className="ui-skel-band-hero" />
              <Skeleton tone="band" className="ui-skel-band-caption" />
              <div className="ui-skel-band-rows">
                <div className="ui-skel-band-row">
                  <Skeleton tone="band" className="ui-skel-band-row-a" />
                  <Skeleton tone="band" className="ui-skel-band-row-b" />
                </div>
                <div className="ui-skel-band-row">
                  <Skeleton tone="band" className="ui-skel-band-row-a" />
                  <Skeleton tone="band" className="ui-skel-band-row-b" />
                </div>
              </div>
            </div>
          </DelayedSkeleton>
        </div>
      </TopBand>
      <DelayedSkeleton>
        <section className="ui-home-split" aria-hidden="true">
          <Skeleton className="ui-skel-split-title" />
          <Skeleton className="ui-skel-split-bar" />
          <div className="ui-skel-split-row">
            <Skeleton className="ui-skel-split-a" />
            <Skeleton className="ui-skel-split-b" />
          </div>
        </section>
        <section className="ui-home-attention ui-skel-attention" aria-hidden="true">
          <Skeleton className="ui-skel-attention-title" />
          <div className="ui-skel-attention-rows">
            <CashSkeletonRow />
            <CashSkeletonRow />
          </div>
        </section>
        <div className="ui-skel-list" aria-hidden="true">
          <Skeleton className="ui-skel-list-title" />
          <CashSkeletonRow />
          <CashSkeletonRow />
          <CashSkeletonRow />
        </div>
      </DelayedSkeleton>
    </div>
  );
}
