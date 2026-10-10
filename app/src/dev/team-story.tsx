import { useState, type ReactNode } from "react";
import { TeamApiProvider } from "../team-api";
import { StoryRoute } from "../ui/story-route";
import { createSampleTeamApi, type SampleTeamOptions } from "./team-sample";

/** FLOW-601 stories: a route with an in-memory team, so the screens read and write without a server. */
export function TeamStory({
  options = {},
  entry,
  tabs = false,
  children,
}: {
  options?: SampleTeamOptions;
  entry: string;
  tabs?: boolean;
  children: ReactNode;
}) {
  const [api] = useState(() => createSampleTeamApi(options));
  return (
    <StoryRoute entry={entry} tabs={tabs}>
      <TeamApiProvider api={api}>{children}</TeamApiProvider>
    </StoryRoute>
  );
}
