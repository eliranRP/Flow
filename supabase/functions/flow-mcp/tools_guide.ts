// MCP get_started: the map of the tools a caller's scope allows, with workflows and rules (FLOW-217).

import { RULES, SERVER_INSTRUCTIONS, TOOL_GROUPS, WORKFLOWS } from "./tools_guide_data.ts";
import { isWriteTool, scopeAllows, toolsFor } from "./tools_specs.ts";

export { RULES, SERVER_INSTRUCTIONS, TOOL_GROUPS, WORKFLOWS } from "./tools_guide_data.ts";

const SUMMARY_MAX = 160;

/** The first sentence of a description, cut at 160 characters. */
export function firstSentence(description: string): string {
  const one = description.replace(/\s+/g, " ").trim();
  const end = one.search(/[.:;] |[.:;]$/);
  const sentence = end >= 0 ? one.slice(0, end + 1) : one;
  return sentence.length <= SUMMARY_MAX ? sentence : sentence.slice(0, SUMMARY_MAX - 1).trimEnd() + "…";
}

export function getStartedPayload(scope: string[]) {
  const summaries = new Map<string, string>();
  for (const spec of toolsFor(["read", "write"])) summaries.set(spec.name, firstSentence(spec.description));
  const allowed = (name: string) => summaries.has(name) && scopeAllows(name, scope);
  const groups = TOOL_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    summary: group.summary,
    tools: group.tools.filter(allowed).map((name) => ({
      name,
      kind: isWriteTool(name) ? "write" as const : "read" as const,
      summary: summaries.get(name) ?? "",
    })),
  })).filter((group) => group.tools.length > 0);
  const workflows = WORKFLOWS.map((workflow) => ({
    ...workflow,
    // A step stays when every tool it names is allowed.
    steps: workflow.steps.filter((step) => {
      const names = step.match(/[a-z]+(?:_[a-z]+)+/g) ?? [];
      return names.every((n) => allowed(n) || !summaries.has(n));
    }),
  })).filter((workflow) => workflow.steps.some((step) => (step.match(/[a-z]+(?:_[a-z]+)+/g) ?? []).some(allowed)));
  return { instructions: SERVER_INSTRUCTIONS, rules: RULES, groups, workflows };
}
