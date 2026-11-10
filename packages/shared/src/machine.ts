/**
 * An explicit state machine: every state, every event, and where each event leads, in one table
 * (decision 0266). An event a state does not list changes nothing, so a guard such as "no second
 * save while one runs" is a missing row, not an `if` in every handler.
 *
 * The table is data: `machineEdges` lists it for a test, a doc or an agent, and `machineProblems`
 * names a state nothing reaches or a state with no way out.
 */
export type MachineTable<S extends string, E extends string> = { readonly [state in S]: { readonly [event in E]?: S } };

export type Machine<S extends string, E extends string> = {
  readonly name: string;
  readonly initial: S;
  /** States that are meant to have no way out. */
  readonly final: readonly S[];
  readonly states: MachineTable<S, E>;
  /** The state after `event`, or `state` itself when the event is not allowed there. */
  next(state: S, event: E): S;
  can(state: S, event: E): boolean;
};

export type MachineEdge<S extends string, E extends string> = { from: S; event: E; to: S };

export function defineMachine<S extends string, E extends string>(spec: {
  name: string;
  initial: S;
  final?: readonly S[];
  states: MachineTable<S, E>;
}): Machine<S, E> {
  const { states } = spec;
  return {
    name: spec.name,
    initial: spec.initial,
    final: spec.final ?? [],
    states,
    next: (state, event) => states[state][event] ?? state,
    can: (state, event) => states[state][event] !== undefined,
  };
}

/** Every transition of the table, in the order it is written. */
export function machineEdges<S extends string, E extends string>(machine: Machine<S, E>): MachineEdge<S, E>[] {
  const edges: MachineEdge<S, E>[] = [];
  for (const from of Object.keys(machine.states) as S[]) {
    const row = machine.states[from];
    for (const event of Object.keys(row) as E[]) {
      const to = row[event];
      if (to !== undefined) edges.push({ from, event, to });
    }
  }
  return edges;
}

/**
 * What is wrong with a table, one line each; empty when it is sound. A machine's own test asserts
 * this is empty, so a state added without a way in or out fails there. (The types already refuse
 * a move to a state the table does not have.)
 */
export function machineProblems<S extends string, E extends string>(machine: Machine<S, E>): string[] {
  const problems: string[] = [];
  const all = Object.keys(machine.states) as S[];
  const edges = machineEdges(machine);
  const reached = new Set<S>([machine.initial]);
  const queue: S[] = [machine.initial];
  for (let from = queue.pop(); from !== undefined; from = queue.pop()) {
    for (const edge of edges) {
      if (edge.from !== from || reached.has(edge.to)) continue;
      reached.add(edge.to);
      queue.push(edge.to);
    }
  }
  for (const state of all) {
    if (!reached.has(state)) problems.push(`${machine.name}: nothing reaches "${state}"`);
    const leaves = edges.some((edge) => edge.from === state && edge.to !== state);
    const final = machine.final.includes(state);
    if (!leaves && !final) problems.push(`${machine.name}: "${state}" has no way out and is not final`);
    if (leaves && final) problems.push(`${machine.name}: "${state}" is final but has a way out`);
  }
  return problems;
}
