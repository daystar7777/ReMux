import { describe, expect, it } from "vitest";
import {
  AGENT_OUTPUT_COALESCE_MS,
  buildProcessAgentState,
  detectAgentFromCommand,
  markAgentOutput,
} from "./agentDetection";

describe("process-tier agent detection", () => {
  it("detects approved initial agent commands", () => {
    expect(detectAgentFromCommand("codex").agentLabel).toBe("Codex");
    expect(detectAgentFromCommand("/usr/local/bin/claude").agentLabel).toBe("Claude");
    expect(detectAgentFromCommand("gemini-cli").agentLabel).toBe("Gemini");
    expect(detectAgentFromCommand("opencode").agentLabel).toBe("OpenCode");
    expect(detectAgentFromCommand("hermes-agent").agentLabel).toBe("Hermes");
  });

  it("does not detect antigravity until its foreground command is explicitly approved", () => {
    expect(detectAgentFromCommand("antigravity").agentLabel).toBeUndefined();
  });

  it("clears stale agent labels when process returns to a shell", () => {
    const previous = buildProcessAgentState({ command: "codex", now: 1_000 });
    const next = buildProcessAgentState({
      command: "zsh",
      now: 2_000,
      previous: previous ?? undefined,
    });

    expect(next?.state).toBe("unknown");
    expect(next?.agentLabel).toBeUndefined();
  });

  it("preserves unacknowledged terminal states when the process exits", () => {
    const previous = {
      ...buildProcessAgentState({ command: "codex", now: 1_000 })!,
      state: "done" as const,
      revision: 5,
    };
    const next = buildProcessAgentState({
      command: "zsh",
      now: 2_000,
      previous,
    });

    expect(next).toBe(previous);
  });

  it("clears acknowledged done when the process exits", () => {
    const previous = {
      ...buildProcessAgentState({ command: "codex", now: 1_000 })!,
      state: "done" as const,
      revision: 5,
      acknowledgedRevision: 5,
    };
    const next = buildProcessAgentState({
      command: "zsh",
      now: 2_000,
      previous,
    });

    expect(next?.state).toBe("unknown");
    expect(next?.agentLabel).toBeUndefined();
  });

  it("marks known-agent output as working without using output heuristics", () => {
    const previous = buildProcessAgentState({ command: "claude", now: 1_000 });
    const next = markAgentOutput(previous ?? undefined, 1_500);

    expect(next?.state).toBe("working");
    expect(next?.agentLabel).toBe("Claude");
  });

  it("does not break done acknowledgement by incrementing revision on process polls", () => {
    const previous = buildProcessAgentState({ command: "gemini", now: 1_000 });
    const done = {
      ...previous!,
      state: "done" as const,
      revision: 4,
      acknowledgedRevision: 4,
    };

    const next = buildProcessAgentState({
      command: "gemini",
      now: 2_000,
      previous: done,
    });

    expect(next?.state).toBe("done");
    expect(next?.revision).toBe(4);
    expect(next?.acknowledgedRevision).toBe(4);
  });

  it("does not reset a live working agent to idle on a routine identity poll", () => {
    const working = markAgentOutput(
      buildProcessAgentState({ command: "codex", now: 1_000 }) ?? undefined,
      1_500,
    );
    expect(working?.state).toBe("working");

    const afterPoll = buildProcessAgentState({
      command: "codex",
      now: 2_000,
      previous: working ?? undefined,
    });

    // Working is owned by output + decay, not by the poll. The poll must not
    // downgrade it, bump its revision, or move its freshness timestamp.
    expect(afterPoll?.state).toBe("working");
    expect(afterPoll?.revision).toBe(working?.revision);
    expect(afterPoll?.updatedAt).toBe(working?.updatedAt);
  });

  it("does not churn the atom when an idle agent is re-confirmed unchanged", () => {
    const idle = buildProcessAgentState({ command: "codex", now: 1_000 });
    const afterPoll = buildProcessAgentState({
      command: "codex",
      now: 2_000,
      previous: idle ?? undefined,
    });

    // Same idle agent, same command: return the identical object reference so
    // Jotai/React do not re-render on every poll.
    expect(afterPoll).toBe(idle);
  });

  it("coalesces rapid output updates while keeping freshness current", () => {
    const previous = markAgentOutput(
      buildProcessAgentState({ command: "codex", now: 1_000 }) ?? undefined,
      1_100,
    );
    const next = markAgentOutput(previous, 1_100 + AGENT_OUTPUT_COALESCE_MS - 1);

    expect(next?.state).toBe("working");
    expect(next?.updatedAt).toBe(1_100 + AGENT_OUTPUT_COALESCE_MS - 1);
    expect(next?.revision).toBe(previous?.revision);
  });
});
