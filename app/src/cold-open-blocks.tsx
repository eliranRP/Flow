import "./ui/lazy.css";
import type { ColdOpenRoute } from "./cold-open-route";
import { FormSkeleton, GroupedSkeleton } from "./ui/loading-shapes";
import { DetailSkeleton, LinesSkeleton, LoansSkeleton, ProfitSkeleton, ProjectsSkeleton, RecurringSkeleton } from "./ui/screen-skeletons";
import { ListSkeleton } from "./ui/skeleton";

/**
 * FLOW-1145: a route's grey blocks in its loading frame (FLOW-1140). They live apart from cold-open.tsx so
 * Home's first load does not carry every screen's skeleton; cold-open.tsx starts loading this file as soon
 * as a frame draws, and the blocks wait 300ms before they show anyway.
 */
export function ColdOpenBlocks({ route }: { route: ColdOpenRoute }) {
  switch (route.shape) {
    case "projects":
      return <ProjectsSkeleton />;
    case "loans":
      return <LoansSkeleton />;
    case "settings":
      return <GroupedSkeleton groups={route.title == null ? [3, 2] : [4, 3]} />;
    case "recurring":
      return <RecurringSkeleton />;
    case "profit":
      return <ProfitSkeleton />;
    case "lines":
      return <LinesSkeleton />;
    case "detail":
      return <DetailSkeleton />;
    case "form":
      return <FormSkeleton figure fields={3} />;
    default:
      return <ListSkeleton />;
  }
}
