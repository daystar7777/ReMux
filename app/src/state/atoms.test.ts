import { describe, it, expect } from "vitest";
import { createStore } from "jotai";
import {
  openTabsAtom,
  activeTabIdAtom,
  cycleTabAction,
  mousePolicyAtom,
  type OpenTab,
  type PaneLayout,
  appearanceAtom,
  applyPresetAction,
  applyExternalConfigAction,
  configAtom,
  pruneWorkspaceForConfig,
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

    // Update settings
    store.set(updateAppearanceAction, { themeName: "Dracula", fontSize: 16 });
    
    const updated = store.get(appearanceAtom);
    expect(updated.themeName).toBe("Dracula");
    expect(updated.fontSize).toBe(16);
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
