export type AgentSemanticState = "blocked" | "working" | "done" | "idle" | "unknown";

export type AgentStateSource = "process" | "heuristic" | "integration" | "manual";

export type AgentStateConfidence = "low" | "medium" | "high";

export interface PaneAgentState {
  state: AgentSemanticState;
  agentLabel?: string;
  source: AgentStateSource;
  confidence: AgentStateConfidence;
  message?: string;
  customStatus?: string;
  updatedAt: number;
  acknowledgedRevision?: number;
  revision: number;
}

export const AGENT_WORKING_DECAY_MS = 15_000;

const STATE_PRIORITY: AgentSemanticState[] = [
  "blocked",
  "done",
  "working",
  "idle",
  "unknown",
];

const NAVIGABLE_STATE_PRIORITY: AgentSemanticState[] = [
  "blocked",
  "done",
  "working",
];

export function isDoneAcknowledged(state: PaneAgentState): boolean {
  return (
    state.state === "done" &&
    state.acknowledgedRevision !== undefined &&
    state.acknowledgedRevision >= state.revision
  );
}

export function effectiveAgentState(
  paneState: PaneAgentState | undefined,
  now = Date.now(),
): AgentSemanticState {
  if (!paneState) return "unknown";
  if (isDoneAcknowledged(paneState)) return "idle";
  if (
    paneState.state === "working" &&
    now - paneState.updatedAt > AGENT_WORKING_DECAY_MS
  ) {
    return "idle";
  }
  return paneState.state;
}

export function rollupAgentState(
  states: Array<PaneAgentState | undefined>,
  now = Date.now(),
): AgentSemanticState {
  let best: AgentSemanticState = "unknown";
  let bestRank = STATE_PRIORITY.indexOf(best);

  for (const paneState of states) {
    const state = effectiveAgentState(paneState, now);
    const rank = STATE_PRIORITY.indexOf(state);
    if (rank !== -1 && rank < bestRank) {
      best = state;
      bestRank = rank;
    }
  }

  return best;
}

export function isNavigableAgentState(state: AgentSemanticState): boolean {
  return NAVIGABLE_STATE_PRIORITY.includes(state);
}

export function pickNavigableAgentPane(
  paneIds: string[],
  states: Record<string, PaneAgentState | undefined>,
  now = Date.now(),
): string | null {
  let bestPaneId: string | null = null;
  let bestRank = NAVIGABLE_STATE_PRIORITY.length;

  for (const paneId of paneIds) {
    const state = effectiveAgentState(states[paneId], now);
    const rank = NAVIGABLE_STATE_PRIORITY.indexOf(state);
    if (rank !== -1 && rank < bestRank) {
      bestPaneId = paneId;
      bestRank = rank;
    }
  }

  return bestPaneId;
}

export function acknowledgeDoneState(state: PaneAgentState | undefined): PaneAgentState | undefined {
  if (!state || state.state !== "done") return state;
  if (state.acknowledgedRevision !== undefined && state.acknowledgedRevision >= state.revision) {
    return state;
  }
  return {
    ...state,
    acknowledgedRevision: state.revision,
  };
}

export function agentStateLabel(state: AgentSemanticState): string {
  switch (state) {
    case "blocked":
      return "Blocked";
    case "done":
      return "Done";
    case "working":
      return "Working";
    case "idle":
      return "Idle";
    case "unknown":
      return "Unknown";
  }
}

export function agentStateTone(state: AgentSemanticState): "danger" | "ok" | "accent" | "muted" {
  if (state === "blocked") return "danger";
  if (state === "done") return "ok";
  if (state === "working") return "accent";
  return "muted";
}

export function collectPaneIdsFromLayout(
  node: { type: "leaf"; id: string } | { type: "row" | "column"; children: Array<any> } | undefined,
): string[] {
  if (!node) return [];
  if (node.type === "leaf") return [node.id];
  return node.children.flatMap(collectPaneIdsFromLayout);
}
