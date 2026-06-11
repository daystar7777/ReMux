import type { PaneAgentState } from "./agentState";

export interface AgentDetectionResult {
  agentLabel?: string;
  command?: string;
}

const KNOWN_AGENT_COMMANDS: Array<{ label: string; patterns: RegExp[] }> = [
  { label: "Codex", patterns: [/^codex(?:$|[-_\s.])/, /^codex-cli$/] },
  { label: "Claude", patterns: [/^claude(?:$|[-_\s.])/, /^claude-code$/] },
  { label: "Gemini", patterns: [/^gemini(?:$|[-_\s.])/, /^gemini-cli$/] },
  { label: "OpenCode", patterns: [/^opencode(?:$|[-_\s.])/] },
  { label: "Hermes", patterns: [/^hermes(?:$|[-_\s.])/, /^hermes-agent$/] },
];

export function normalizeCommandName(command: string | undefined): string {
  if (!command) return "";
  const trimmed = command.trim();
  if (!trimmed) return "";
  const basename = trimmed.split(/[\\/]/).pop() ?? trimmed;
  return basename.toLowerCase();
}

export function detectAgentFromCommand(command: string | undefined): AgentDetectionResult {
  const normalized = normalizeCommandName(command);
  if (!normalized) return {};

  for (const entry of KNOWN_AGENT_COMMANDS) {
    if (entry.patterns.some((pattern) => pattern.test(normalized))) {
      return {
        agentLabel: entry.label,
        command: normalized,
      };
    }
  }
  return {};
}

export function buildProcessAgentState(args: {
  command?: string;
  previous?: PaneAgentState;
  now: number;
}): PaneAgentState | null {
  const detected = detectAgentFromCommand(args.command);
  const previous = args.previous;

  if (!detected.agentLabel) {
    if (
      previous?.agentLabel &&
      (previous.state === "blocked" || previous.state === "done") &&
      (previous.acknowledgedRevision === undefined ||
        previous.acknowledgedRevision < previous.revision)
    ) {
      return previous;
    }
    if (previous?.agentLabel) {
      return {
        state: "unknown",
        source: "process",
        confidence: "medium",
        updatedAt: args.now,
        revision: previous.revision + 1,
      };
    }
    return null;
  }

  if (previous?.agentLabel === detected.agentLabel) {
    // Same agent re-confirmed by a routine identity poll. Never disturb live
    // lifecycle state here: blocked/done stay sticky until acknowledgement, and
    // working is owned by markAgentOutput + the 15s decay in effectiveAgentState.
    // Resetting working -> idle on every poll would wipe a live agent and make
    // the decay timer dead code. idle is the resting baseline and is preserved.
    // Only refresh the command message, and avoid allocating a new object (which
    // churns the atom and re-renders badges) when nothing actually changed.
    if (
      previous.state === "blocked" ||
      previous.state === "done" ||
      previous.state === "working" ||
      previous.state === "idle"
    ) {
      return previous.message === detected.command
        ? previous
        : { ...previous, message: detected.command };
    }
    // An "unknown" state still carrying a matching label is unexpected; treat
    // re-confirmation as re-establishing the idle baseline.
    return {
      ...previous,
      state: "idle",
      source: "process",
      confidence: "medium",
      message: detected.command,
      updatedAt: args.now,
      revision: previous.revision + 1,
    };
  }

  return {
    state: "idle",
    agentLabel: detected.agentLabel,
    source: "process",
    confidence: "medium",
    message: detected.command,
    updatedAt: args.now,
    revision: (previous?.revision ?? 0) + 1,
  };
}

export const AGENT_OUTPUT_COALESCE_MS = 1_000;

export function markAgentOutput(
  previous: PaneAgentState | undefined,
  now: number,
): PaneAgentState | undefined {
  if (!previous?.agentLabel) return previous;
  if (previous.state === "blocked" || previous.state === "done") {
    return {
      ...previous,
      updatedAt: now,
    };
  }
  if (previous.state === "working" && now - previous.updatedAt < AGENT_OUTPUT_COALESCE_MS) {
    return {
      ...previous,
      updatedAt: now,
    };
  }
  return {
    ...previous,
    state: "working",
    source: previous.source === "manual" ? "manual" : "process",
    updatedAt: now,
    revision: previous.revision + 1,
  };
}
