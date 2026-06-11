import { describe, expect, it, vi } from "vitest";
import { createStore } from "jotai";
import {
  activateAgentPaneAction,
  acknowledgePaneAgentDoneAction,
  activeProfileAtom,
  openTabsAtom,
  openEphemeralTabAction,
  activeTabIdAtom,
  cycleTabAction,
  mousePolicyAtom,
  paneAgentStateAtom,
  type OpenTab,
  type PaneLayout,
  appearanceAtom,
  applyPresetAction,
  applyExternalConfigAction,
  configAtom,
  migrateSessionInProfiles,
  pruneWorkspaceForConfig,
  recoverLeafForEmptyLayout,
  refreshPaneIdentitiesAction,
  sanitizePersistedLayout,
  updateAppearanceAction,
  rightPanelOpenAtom,
  DEFAULT_APPEARANCE,
} from "./atoms";
import type { AppConfig, Host, Profile } from "../types/config";

describe("cycleTabAction", () => {
  it("does nothing if there are 0 or 1 tabs", () => {
    const store = createStore();
    
    // Test 0 tabs
    store.set(openTabsAtom, []);
    store.set(activeTabIdAtom, null);
    store.set(cycleTabAction, "forward");
    expect(store.get(activeTabIdAtom)).toBeNull();

    // Test 1 tab
    const tab1: OpenTab = { id: "tab1", profileId: "prof1", state: "idle" };
    store.set(openTabsAtom, [tab1]);
    store.set(activeTabIdAtom, "tab1");
    store.set(cycleTabAction, "forward");
    expect(store.get(activeTabIdAtom)).toBe("tab1");
  });

  it("cycles forward and backward correctly with multiple tabs", () => {
    const store = createStore();
    const tab1: OpenTab = { id: "tab1", profileId: "prof1", state: "idle" };
    const tab2: OpenTab = { id: "tab2", profileId: "prof2", state: "idle" };
    const tab3: OpenTab = { id: "tab3", profileId: "prof3", state: "idle" };

    store.set(openTabsAtom, [tab1, tab2, tab3]);
    store.set(activeTabIdAtom, "tab1");

    // Cycle forward: tab1 -> tab2
    store.set(cycleTabAction, "forward");
    expect(store.get(activeTabIdAtom)).toBe("tab2");

    // Cycle forward: tab2 -> tab3
    store.set(cycleTabAction, "forward");
    expect(store.get(activeTabIdAtom)).toBe("tab3");

    // Cycle forward (wrapping): tab3 -> tab1
    store.set(cycleTabAction, "forward");
    expect(store.get(activeTabIdAtom)).toBe("tab1");

    // Cycle backward (wrapping): tab1 -> tab3
    store.set(cycleTabAction, "backward");
    expect(store.get(activeTabIdAtom)).toBe("tab3");

    // Cycle backward: tab3 -> tab2
    store.set(cycleTabAction, "backward");
    expect(store.get(activeTabIdAtom)).toBe("tab2");
  });
});

describe("mousePolicyAtom", () => {
  it("stores mouse policy per active tab", () => {
    const store = createStore();
    const tab1: OpenTab = { id: "tab1", profileId: "prof1", state: "idle", mousePolicy: "remux" };
    const tab2: OpenTab = { id: "tab2", profileId: "prof2", state: "idle", mousePolicy: "tmux" };

    store.set(openTabsAtom, [tab1, tab2]);

    store.set(activeTabIdAtom, "tab1");
    expect(store.get(mousePolicyAtom)).toBe("remux");
    store.set(mousePolicyAtom, "tmux");
    expect(store.get(openTabsAtom).find((t) => t.id === "tab1")?.mousePolicy).toBe("tmux");
    expect(store.get(openTabsAtom).find((t) => t.id === "tab2")?.mousePolicy).toBe("tmux");

    store.set(activeTabIdAtom, "tab2");
    expect(store.get(mousePolicyAtom)).toBe("tmux");
    store.set(mousePolicyAtom, "remux");
    expect(store.get(openTabsAtom).find((t) => t.id === "tab1")?.mousePolicy).toBe("tmux");
    expect(store.get(openTabsAtom).find((t) => t.id === "tab2")?.mousePolicy).toBe("remux");
  });

  it("defaults missing tab mouse policy to remux", () => {
    const store = createStore();
    const tab: OpenTab = { id: "tab1", profileId: "prof1", state: "idle" };
    store.set(openTabsAtom, [tab]);
    store.set(activeTabIdAtom, "tab1");

    expect(store.get(mousePolicyAtom)).toBe("remux");
  });
});

const collectLeafIds = (node: PaneLayout): string[] => {
  if (node.type === "leaf") return [node.id];
  return node.children.flatMap(collectLeafIds);
};

describe("applyPresetAction", () => {
  const tabWithLayout = (layout: PaneLayout): OpenTab => ({
    id: "tab1",
    profileId: "prof1",
    state: "connected",
    layout,
  });

  it("preserves leaves while applying even-grid layout", () => {
    const store = createStore();
    const layout: PaneLayout = {
      type: "row",
      id: "root",
      children: [
        { type: "leaf", id: "pane1", ptyId: "pty1" },
        { type: "leaf", id: "pane2", ptyId: "pty2" },
        { type: "leaf", id: "pane3", ptyId: "pty3" },
      ],
    };
    store.set(openTabsAtom, [tabWithLayout(layout)]);

    store.set(applyPresetAction, { tabId: "tab1", preset: "even" });

    const next = store.get(openTabsAtom)[0].layout;
    expect(next?.type).not.toBe("leaf");
    expect(collectLeafIds(next!)).toEqual(["pane1", "pane2", "pane3"]);
  });

  it("applies main-left and main-top roots without dropping tmux identity", () => {
    const store = createStore();
    const layout: PaneLayout = {
      type: "column",
      id: "root",
      children: [
        {
          type: "leaf",
          id: "pane1",
          ptyId: "pty1",
          tmuxIdentity: {
            paneId: "%1",
            windowId: "@1",
            sessionId: "$1",
            sessionName: "remux",
            windowIndex: 1,
            windowName: "zsh",
            paneIndex: 1,
          },
        },
        { type: "leaf", id: "pane2", ptyId: "pty2" },
      ],
    };
    store.set(openTabsAtom, [tabWithLayout(layout)]);

    store.set(applyPresetAction, { tabId: "tab1", preset: "main-left" });
    const mainLeft = store.get(openTabsAtom)[0].layout;
    expect(mainLeft?.type).toBe("column");
    expect(collectLeafIds(mainLeft!)).toEqual(["pane1", "pane2"]);
    expect(collectLeafIds(mainLeft!)[0]).toBe("pane1");

    store.set(applyPresetAction, { tabId: "tab1", preset: "main-top" });
    const mainTop = store.get(openTabsAtom)[0].layout;
    expect(mainTop?.type).toBe("row");
    expect(collectLeafIds(mainTop!)).toEqual(["pane1", "pane2"]);
    expect((collectLeafIds(mainTop!)[0])).toBe("pane1");
  });

  it("does nothing for a single-pane layout", () => {
    const store = createStore();
    const layout: PaneLayout = { type: "leaf", id: "pane1", ptyId: "pty1" };
    store.set(openTabsAtom, [tabWithLayout(layout)]);

    store.set(applyPresetAction, { tabId: "tab1", preset: "main-top" });

    expect(store.get(openTabsAtom)[0].layout).toBe(layout);
  });

  it("recovers empty layout from a previous leaf without rotating the pane id", () => {
    const previous = { type: "leaf" as const, id: "pane-stable", ptyId: "pty-stable" };

    expect(recoverLeafForEmptyLayout(previous)).toEqual({
      ...previous,
      tmuxIdentity: null,
      ptyId: null,
    });
  });

  it("sanitizes malformed persisted layout by carrying the active pane id forward", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sanitized = sanitizePersistedLayout(
      { type: "row", id: "bad-root", children: [] },
      "pane-survivor",
    );

    expect(sanitized).toEqual({
      type: "leaf",
      id: "pane-survivor",
      ptyId: null,
      tmuxIdentity: null,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Recovered malformed persisted layout"));
    warn.mockRestore();
  });

  it("drops malformed persisted children without rotating valid surviving leaf ids", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sanitized = sanitizePersistedLayout(
      {
        type: "column",
        id: "root",
        children: [
          { type: "leaf", id: "pane-stable", ptyId: "old" },
          { type: "leaf", id: "", ptyId: "bad" },
          { type: "bogus", id: "nope" },
        ],
      },
      "pane-stable",
    );

    expect(collectLeafIds(sanitized!)).toEqual(["pane-stable"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Recovered malformed persisted layout"));
    warn.mockRestore();
  });
});

describe("refreshPaneIdentitiesAction agent state", () => {
  it("detects known agent process commands without changing pane ids", () => {
    const store = createStore();
    const layout: PaneLayout = {
      type: "row",
      id: "root",
      children: [
        { type: "leaf", id: "pane-codex", ptyId: "pty1" },
        { type: "leaf", id: "pane-shell", ptyId: "pty2" },
      ],
    };
    store.set(openTabsAtom, [
      {
        id: "tab-agent",
        profileId: "prof1",
        state: "connected",
        layout,
      },
    ]);

    store.set(refreshPaneIdentitiesAction, {
      tabId: "tab-agent",
      sessionPanes: [
        {
          paneId: "%1",
          windowId: "@1",
          sessionId: "$1",
          sessionName: "remux",
          windowIndex: 0,
          windowName: "main",
          paneIndex: 0,
          paneCurrentCommand: "codex",
        },
        {
          paneId: "%2",
          windowId: "@1",
          sessionId: "$1",
          sessionName: "remux",
          windowIndex: 0,
          windowName: "main",
          paneIndex: 1,
          paneCurrentCommand: "zsh",
        },
      ],
    });

    const nextLayout = store.get(openTabsAtom)[0].layout;
    expect(collectLeafIds(nextLayout!)).toEqual(["pane-codex", "pane-shell"]);
    expect(store.get(paneAgentStateAtom)["pane-codex"].agentLabel).toBe("Codex");
    expect(store.get(paneAgentStateAtom)["pane-codex"].state).toBe("idle");
    expect(store.get(paneAgentStateAtom)["pane-shell"]).toBeUndefined();
  });
});

describe("agent pane navigation actions", () => {
  const layout: PaneLayout = {
    type: "row",
    id: "root",
    children: [
      { type: "leaf", id: "pane-working", ptyId: "pty1" },
      { type: "leaf", id: "pane-done", ptyId: "pty2" },
      { type: "leaf", id: "pane-blocked", ptyId: "pty3" },
    ],
  };

  it("activates the highest-priority agent pane in the target tab", () => {
    const store = createStore();
    store.set(openTabsAtom, [
      {
        id: "tab-agent",
        profileId: "prof1",
        state: "connected",
        layout,
        activePaneId: "pane-working",
      },
    ]);
    store.set(activeTabIdAtom, "tab-agent");
    store.set(paneAgentStateAtom, {
      "pane-working": {
        state: "working",
        agentLabel: "Codex",
        source: "process",
        confidence: "medium",
        updatedAt: Date.now(),
        revision: 1,
      },
      "pane-done": {
        state: "done",
        agentLabel: "Claude",
        source: "integration",
        confidence: "high",
        updatedAt: Date.now(),
        revision: 2,
      },
      "pane-blocked": {
        state: "blocked",
        agentLabel: "Gemini",
        source: "manual",
        confidence: "high",
        updatedAt: Date.now(),
        revision: 3,
      },
    });

    const selected = store.set(activateAgentPaneAction, { tabId: "tab-agent" });

    expect(selected).toBe("pane-blocked");
    expect(store.get(openTabsAtom)[0].activePaneId).toBe("pane-blocked");
  });

  it("acknowledges done when a done pane is selected", () => {
    const store = createStore();
    store.set(paneAgentStateAtom, {
      "pane-done": {
        state: "done",
        agentLabel: "Claude",
        source: "integration",
        confidence: "high",
        updatedAt: Date.now(),
        revision: 9,
      },
    });

    store.set(acknowledgePaneAgentDoneAction, "pane-done");

    expect(store.get(paneAgentStateAtom)["pane-done"].acknowledgedRevision).toBe(9);
  });
});

const host = (id: string): Host => ({
  id,
  label: id,
  address: "127.0.0.1",
  port: 22,
  username: "storysq",
  auth_method: "agent",
  detach_other_clients: false,
  clipboard_policy: "allow",
});

const profile = (id: string, hostId: string): Profile => ({
  id,
  display_alias: id,
  host_id: hostId,
  tmux_session_name: id,
});

describe("migrateSessionInProfiles", () => {
  const p = (id: string, hostId: string, session: string, alias: string): Profile => ({
    ...profile(id, hostId),
    tmux_session_name: session,
    display_alias: alias,
  });

  it("migrates every same-host profile targeting the renamed session, alias untouched", () => {
    const profiles: Profile[] = [
      p("a", "h1", "work", "host1 · work"),
      p("b", "h1", "work", "my custom work label"),
      p("c", "h1", "other", "host1 · other"),
      p("d", "h2", "work", "host2 · work"),
    ];

    const next = migrateSessionInProfiles(profiles, "h1", "work", "build");
    expect(next).not.toBeNull();
    const byId = Object.fromEntries(next!.map((x) => [x.id, x]));

    // Both h1/work profiles migrate their target.
    expect(byId.a.tmux_session_name).toBe("build");
    expect(byId.b.tmux_session_name).toBe("build");
    // display_alias is a local label and is never rewritten.
    expect(byId.a.display_alias).toBe("host1 · work");
    expect(byId.b.display_alias).toBe("my custom work label");
    // Different session on same host, and same session on a different host, untouched.
    expect(byId.c.tmux_session_name).toBe("other");
    expect(byId.d.tmux_session_name).toBe("work");
  });

  it("returns null when nothing matches, to skip a redundant save", () => {
    const profiles: Profile[] = [p("a", "h1", "work", "work")];
    expect(migrateSessionInProfiles(profiles, "h1", "absent", "build")).toBeNull();
    expect(migrateSessionInProfiles(profiles, "h2", "work", "build")).toBeNull();
  });

  it("returns null for a no-op or empty rename", () => {
    const profiles: Profile[] = [p("a", "h1", "work", "work")];
    expect(migrateSessionInProfiles(profiles, "h1", "work", "work")).toBeNull();
    expect(migrateSessionInProfiles(profiles, "h1", "work", "")).toBeNull();
  });
});

describe("ephemeral discovery tabs", () => {
  it("opens a discovered target without adding a saved profile", () => {
    const store = createStore();
    const discovered: Profile = {
      id: "prof_discovered",
      host_id: "h1",
      tmux_session_name: "work",
      tmux_window_target: "@7",
      display_alias: "localhost · work:0 editor",
    };

    const tabId = store.set(openEphemeralTabAction, discovered);

    expect(store.get(configAtom).profiles).toEqual([]);
    expect(store.get(activeTabIdAtom)).toBe(tabId);
    expect(store.get(openTabsAtom)[0].ephemeralProfile).toEqual(discovered);
    expect(store.get(activeProfileAtom)).toEqual(discovered);
  });

  it("keeps ephemeral tabs during config pruning", () => {
    const ephemeral: OpenTab = {
      id: "tab_ephemeral",
      profileId: "prof_ephemeral",
      ephemeralProfile: {
        id: "prof_ephemeral",
        host_id: "h1",
        tmux_session_name: "work",
        display_alias: "temporary",
      },
      state: "idle",
    };
    const stale: OpenTab = { id: "tab_stale", profileId: "missing", state: "idle" };

    const pruned = pruneWorkspaceForConfig([ephemeral, stale], "tab_stale", {
      hosts: [host("h1")],
      profiles: [],
      version: 1,
    });

    expect(pruned.tabs).toEqual([ephemeral]);
    expect(pruned.activeTabId).toBe("tab_ephemeral");
  });
});

describe("workspace persistence cleanup", () => {
  it("prunes tabs that reference profiles missing from config", () => {
    const cfg: AppConfig = {
      version: 1,
      hosts: [host("host1")],
      profiles: [profile("profile1", "host1")],
    };
    const tabs: OpenTab[] = [
      { id: "tab1", profileId: "profile1", state: "idle" },
      { id: "tab2", profileId: "missing-profile", state: "idle" },
    ];

    const pruned = pruneWorkspaceForConfig(tabs, "tab2", cfg);

    expect(pruned.tabs.map((t) => t.id)).toEqual(["tab1"]);
    expect(pruned.activeTabId).toBe("tab1");
  });

  it("clears active tab when every persisted tab is stale", () => {
    const cfg: AppConfig = {
      version: 1,
      hosts: [host("host1")],
      profiles: [],
    };
    const tabs: OpenTab[] = [
      { id: "tab1", profileId: "missing-profile", state: "idle" },
    ];

    const pruned = pruneWorkspaceForConfig(tabs, "tab1", cfg);

    expect(pruned.tabs).toEqual([]);
    expect(pruned.activeTabId).toBeNull();
  });

  it("prunes stale tabs when external config is applied", () => {
    const store = createStore();
    const cfg: AppConfig = {
      version: 1,
      hosts: [host("host1")],
      profiles: [profile("profile1", "host1")],
    };
    store.set(openTabsAtom, [
      { id: "tab1", profileId: "profile1", state: "idle" },
      { id: "tab2", profileId: "missing-profile", state: "idle" },
    ]);
    store.set(activeTabIdAtom, "tab2");

    store.set(applyExternalConfigAction, cfg);

    expect(store.get(configAtom)).toEqual(cfg);
    expect(store.get(openTabsAtom).map((t) => t.id)).toEqual(["tab1"]);
    expect(store.get(activeTabIdAtom)).toBe("tab1");
  });
});

describe("appearance settings", () => {
  it("initializes with default values and updates correctly", () => {
    const store = createStore();
    
    // Default appearance
    const current = store.get(appearanceAtom);
    expect(current.themeName).toBe(DEFAULT_APPEARANCE.themeName);
    expect(current.fontSize).toBe(DEFAULT_APPEARANCE.fontSize);
    expect(current.macOptionIsMeta).toBe(false);

    // Update settings
    store.set(updateAppearanceAction, { themeName: "Dracula", fontSize: 16, macOptionIsMeta: true });
    
    const updated = store.get(appearanceAtom);
    expect(updated.themeName).toBe("Dracula");
    expect(updated.fontSize).toBe(16);
    expect(updated.macOptionIsMeta).toBe(true);
    expect(updated.lineHeight).toBe(DEFAULT_APPEARANCE.lineHeight); // Unchanged fields remain
  });

  it("toggles the right panel open state", () => {
    const store = createStore();
    expect(store.get(rightPanelOpenAtom)).toBe(false);
    
    store.set(rightPanelOpenAtom, true);
    expect(store.get(rightPanelOpenAtom)).toBe(true);
  });
});

import { getThemeColors } from "../lib/themes";

describe("themes library", () => {
  it("returns the correct color configs for presets", () => {
    const dracula = getThemeColors("Dracula");
    expect(dracula.background).toBe("#282a36");
    expect(dracula.foreground).toBe("#f8f8f2");

    const fallback = getThemeColors("NonExistentTheme");
    expect(fallback.background).toBe("#0b0d12"); // Falls back to Remux Dark
  });
});
