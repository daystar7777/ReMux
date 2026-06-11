import { describe, expect, it } from "vitest";
import {
  AGENT_WORKING_DECAY_MS,
  acknowledgeDoneState,
  effectiveAgentState,
  isNavigableAgentState,
  pickNavigableAgentPane,
  rollupAgentState,
  type PaneAgentState,
} from "./agentState";

const state = (patch: Partial<PaneAgentState>): PaneAgentState => ({
  state: "unknown",
  source: "process",
  confidence: "medium",
  updatedAt: 1_000,
  revision: 1,
  ...patch,
});

describe("agent state rollup", () => {
  it("prioritizes blocked, then unacknowledged done, then working, idle, and unknown", () => {
    const now = 2_000;
    expect(
      rollupAgentState([
        state({ state: "working" }),
        state({ state: "done" }),
        state({ state: "idle" }),
      ], now),
    ).toBe("done");

    expect(
      rollupAgentState([
        state({ state: "working" }),
        state({ state: "done" }),
        state({ state: "blocked" }),
      ], now),
    ).toBe("blocked");
  });

  it("does not let acknowledged done dominate rollups", () => {
    const now = 2_000;
    expect(
      rollupAgentState([
        state({ state: "done", revision: 4, acknowledgedRevision: 4 }),
        state({ state: "working" }),
      ], now),
    ).toBe("working");
  });

  it("decays stale working state to idle at read time", () => {
    const staleWorking = state({
      state: "working",
      updatedAt: 1_000,
    });

    expect(effectiveAgentState(staleWorking, 1_000 + AGENT_WORKING_DECAY_MS)).toBe("working");
    expect(effectiveAgentState(staleWorking, 1_001 + AGENT_WORKING_DECAY_MS)).toBe("idle");
  });

  it("picks the highest-priority actionable agent pane", () => {
    expect(
      pickNavigableAgentPane(["pane-idle", "pane-working", "pane-done"], {
        "pane-idle": state({ state: "idle" }),
        "pane-working": state({ state: "working" }),
        "pane-done": state({ state: "done" }),
      }),
    ).toBe("pane-done");

    expect(
      pickNavigableAgentPane(["pane-working", "pane-blocked"], {
        "pane-working": state({ state: "working" }),
        "pane-blocked": state({ state: "blocked" }),
      }),
    ).toBe("pane-blocked");

    expect(
      pickNavigableAgentPane(["pane-idle"], {
        "pane-idle": state({ state: "idle" }),
      }),
    ).toBeNull();
  });

  it("treats only blocked/done/working as navigable jump targets", () => {
    expect(isNavigableAgentState("blocked")).toBe(true);
    expect(isNavigableAgentState("done")).toBe(true);
    expect(isNavigableAgentState("working")).toBe(true);
    expect(isNavigableAgentState("idle")).toBe(false);
    expect(isNavigableAgentState("unknown")).toBe(false);
  });

  it("acknowledges done without disturbing other states", () => {
    const done = state({ state: "done", revision: 7 });
    expect(acknowledgeDoneState(done)?.acknowledgedRevision).toBe(7);

    const acknowledged = { ...done, acknowledgedRevision: 7 };
    expect(acknowledgeDoneState(acknowledged)).toBe(acknowledged);

    const working = state({ state: "working", revision: 3 });
    expect(acknowledgeDoneState(working)).toBe(working);
  });
});
