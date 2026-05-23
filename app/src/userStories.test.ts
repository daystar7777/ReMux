import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import {
  activeTabAtom,
  activeTabIdAtom,
  closePaneAction,
  configAtom,
  cyclePaneAction,
  mousePolicyAtom,
  openTabAction,
  openTabsAtom,
  splitPaneAction,
  type OpenTab,
  type PaneLayout,
} from "./state/atoms";
import { attachOrCreateCommand } from "./lib/tmux";
import {
  nativeTmuxDisabledReason,
  supportsNativeTmuxCommands,
} from "./lib/remotePolicy";
import { validateProfile } from "./types/config";
import type { AppConfig, Host, Profile } from "./types/config";

const localHost: Host = {
  id: "host-local",
  label: "Local",
  address: "127.0.0.1",
  port: 0,
  username: "",
  auth_method: "local",
  detach_other_clients: false,
  clipboard_policy: "allow",
};

const passwordHost: Host = {
  id: "host-password",
  label: "Password Host",
  address: "ssh.example.com",
  port: 22,
  username: "storysq",
  auth_method: "password",
  detach_other_clients: false,
  clipboard_policy: "allow",
};

const localProfile: Profile = {
  id: "profile-local",
  display_alias: "Local Work",
  host_id: localHost.id,
  tmux_session_name: "remux-dev",
};

function installConfig(store: ReturnType<typeof createStore>, cfg: AppConfig) {
  store.set(configAtom, cfg);
}

function leafIds(layout: PaneLayout | undefined): string[] {
  if (!layout) return [];
  if (layout.type === "leaf") return [layout.id];
  return layout.children.flatMap(leafIds);
}

describe("REMUX user test stories", () => {
  it("story: create a local workspace profile and open one reusable tmux workspace tab", () => {
    const store = createStore();
    installConfig(store, {
      version: 1,
      hosts: [localHost],
      profiles: [localProfile],
    });

    const firstTabId = store.set(openTabAction, localProfile.id);
    const secondTabId = store.set(openTabAction, localProfile.id);

    expect(secondTabId).toBe(firstTabId);
    expect(store.get(openTabsAtom)).toHaveLength(1);
    expect(store.get(activeTabAtom)?.profileId).toBe(localProfile.id);
    expect(store.get(activeTabAtom)?.layout?.type).toBe("leaf");
  });

  it("story: attach or create the configured tmux target without detaching other clients by default", () => {
    expect(
      attachOrCreateCommand({
        session: "remux-dev",
        window: "server",
        socketPath: "/private/tmp/remux-test",
      }),
    ).toEqual([
      "tmux",
      "-S",
      "/private/tmp/remux-test",
      "new-session",
      "-A",
      "-s",
      "remux-dev",
      "-n",
      "server",
      ";",
      "set-option",
      "-t",
      "remux-dev",
      "mouse",
      "off",
    ]);
  });

  it("story: split, move focus, and close panes while preserving the tab until the final pane closes", () => {
    const store = createStore();
    const tab: OpenTab = {
      id: "tab-1",
      profileId: localProfile.id,
      state: "connected",
      layout: { type: "leaf", id: "pane-1", ptyId: "pty-1" },
      activePaneId: "pane-1",
    };
    store.set(openTabsAtom, [tab]);
    store.set(activeTabIdAtom, tab.id);

    const pane2 = store.set(splitPaneAction, {
      tabId: tab.id,
      paneId: "pane-1",
      direction: "column",
    });
    const pane3 = store.set(splitPaneAction, {
      tabId: tab.id,
      paneId: pane2!,
      direction: "row",
    });

    expect(leafIds(store.get(activeTabAtom)?.layout)).toHaveLength(3);
    expect(store.get(activeTabAtom)?.activePaneId).toBe(pane3);

    store.set(cyclePaneAction, "forward");
    expect(store.get(activeTabAtom)?.activePaneId).toBe("pane-1");

    store.set(closePaneAction, { tabId: tab.id, paneId: "pane-1" });
    expect(leafIds(store.get(activeTabAtom)?.layout)).toHaveLength(2);
    expect(store.get(openTabsAtom)).toHaveLength(1);

    store.set(closePaneAction, { tabId: tab.id, paneId: pane2! });
    store.set(closePaneAction, { tabId: tab.id, paneId: pane3! });
    expect(store.get(openTabsAtom)).toEqual([]);
    expect(store.get(activeTabIdAtom)).toBeNull();
  });

  it("story: keep per-tab mouse policy separate when switching between workspaces", () => {
    const store = createStore();
    store.set(openTabsAtom, [
      { id: "tab-1", profileId: "profile-1", state: "connected", mousePolicy: "remux" },
      { id: "tab-2", profileId: "profile-2", state: "connected", mousePolicy: "tmux" },
    ]);

    store.set(activeTabIdAtom, "tab-1");
    store.set(mousePolicyAtom, "tmux");

    store.set(activeTabIdAtom, "tab-2");
    store.set(mousePolicyAtom, "remux");

    expect(store.get(openTabsAtom).map((tab) => [tab.id, tab.mousePolicy])).toEqual([
      ["tab-1", "tmux"],
      ["tab-2", "remux"],
    ]);
  });

  it("story: block invalid tmux session names before the user reaches backend save failure", () => {
    expect(
      validateProfile({
        display_alias: "Bad Session",
        host_id: localHost.id,
        tmux_session_name: "bad session",
      }),
    ).toBe("Tmux session name may only contain letters, numbers, dots, underscores, and hyphens");

    expect(
      validateProfile({
        display_alias: "Good Session",
        host_id: localHost.id,
        tmux_session_name: "good.session_01",
      }),
    ).toBeNull();
  });

  it("story: password-auth hosts can attach interactively and now support native tmux commands via key auto-provisioning", () => {
    expect(supportsNativeTmuxCommands(passwordHost)).toBe(true);
    expect(nativeTmuxDisabledReason(passwordHost, "Split pane")).toBeUndefined();

    expect(supportsNativeTmuxCommands(localHost)).toBe(true);
    expect(nativeTmuxDisabledReason(localHost, "Split pane")).toBeUndefined();
  });
});
