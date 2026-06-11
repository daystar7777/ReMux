import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Provider, createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TopTabs } from "./TopTabs";
import {
  activeTabIdAtom,
  configAtom,
  openTabsAtom,
  paneAgentStateAtom,
  type OpenTab,
} from "../state/atoms";
import type { AppConfig } from "../types/config";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../lib/ipc", () => ({
  openNewWindow: vi.fn(async () => {}),
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  document.body.innerHTML = "";
});

describe("TopTabs agent rollup badge", () => {
  it("renders the highest priority agent state for a tab", () => {
    const store = createStore();
    const tab: OpenTab = {
      id: "tab-1",
      profileId: "profile-1",
      state: "connected",
      activePaneId: "pane-1",
      layout: {
        type: "row",
        id: "root",
        children: [
          { type: "leaf", id: "pane-1", ptyId: "pty-1" },
          { type: "leaf", id: "pane-2", ptyId: "pty-2" },
        ],
      },
    };
    const config: AppConfig = {
      version: 1,
      hosts: [
        {
          id: "host-1",
          label: "local",
          address: "127.0.0.1",
          port: 0,
          username: "",
          auth_method: "local",
          detach_other_clients: false,
          clipboard_policy: "allow",
        },
      ],
      profiles: [
        {
          id: "profile-1",
          host_id: "host-1",
          display_alias: "Local Agent",
          tmux_session_name: "remux",
        },
      ],
    };

    store.set(configAtom, config);
    store.set(openTabsAtom, [tab]);
    store.set(activeTabIdAtom, tab.id);
    store.set(paneAgentStateAtom, {
      "pane-1": {
        state: "working",
        agentLabel: "Codex",
        source: "process",
        confidence: "medium",
        updatedAt: Date.now(),
        revision: 1,
      },
      "pane-2": {
        state: "done",
        agentLabel: "Claude",
        source: "process",
        confidence: "medium",
        updatedAt: Date.now(),
        revision: 2,
      },
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <Provider store={store}>
          <TopTabs />
        </Provider>,
      );
    });

    expect(container.textContent).toContain("Local Agent");
    expect(container.textContent).toContain("done");
  });

  it("jumps to the highest-priority agent pane when the badge is clicked", () => {
    const store = createStore();
    const tab: OpenTab = {
      id: "tab-1",
      profileId: "profile-1",
      state: "connected",
      activePaneId: "pane-1",
      layout: {
        type: "row",
        id: "root",
        children: [
          { type: "leaf", id: "pane-1", ptyId: "pty-1" },
          { type: "leaf", id: "pane-2", ptyId: "pty-2" },
        ],
      },
    };
    const config: AppConfig = {
      version: 1,
      hosts: [
        {
          id: "host-1",
          label: "local",
          address: "127.0.0.1",
          port: 0,
          username: "",
          auth_method: "local",
          detach_other_clients: false,
          clipboard_policy: "allow",
        },
      ],
      profiles: [
        {
          id: "profile-1",
          host_id: "host-1",
          display_alias: "Local Agent",
          tmux_session_name: "remux",
        },
      ],
    };

    store.set(configAtom, config);
    store.set(openTabsAtom, [tab]);
    store.set(activeTabIdAtom, tab.id);
    store.set(paneAgentStateAtom, {
      "pane-1": {
        state: "working",
        agentLabel: "Codex",
        source: "process",
        confidence: "medium",
        updatedAt: Date.now(),
        revision: 1,
      },
      "pane-2": {
        state: "done",
        agentLabel: "Claude",
        source: "process",
        confidence: "medium",
        updatedAt: Date.now(),
        revision: 2,
      },
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <Provider store={store}>
          <TopTabs />
        </Provider>,
      );
    });

    const badge = container.querySelector('[aria-label="Jump to done agent pane"]') as HTMLElement;
    act(() => {
      badge.click();
    });

    expect(store.get(openTabsAtom)[0].activePaneId).toBe("pane-2");
    expect(store.get(paneAgentStateAtom)["pane-2"].acknowledgedRevision).toBe(2);
  });

  it("renders an idle rollup as a passive indicator, not a dead jump control", () => {
    const store = createStore();
    const tab: OpenTab = {
      id: "tab-1",
      profileId: "profile-1",
      state: "connected",
      activePaneId: "pane-1",
      layout: {
        type: "row",
        id: "root",
        children: [
          { type: "leaf", id: "pane-1", ptyId: "pty-1" },
          { type: "leaf", id: "pane-2", ptyId: "pty-2" },
        ],
      },
    };
    const config: AppConfig = {
      version: 1,
      hosts: [
        {
          id: "host-1",
          label: "local",
          address: "127.0.0.1",
          port: 0,
          username: "",
          auth_method: "local",
          detach_other_clients: false,
          clipboard_policy: "allow",
        },
      ],
      profiles: [
        {
          id: "profile-1",
          host_id: "host-1",
          display_alias: "Local Agent",
          tmux_session_name: "remux",
        },
      ],
    };

    store.set(configAtom, config);
    store.set(openTabsAtom, [tab]);
    store.set(activeTabIdAtom, tab.id);
    store.set(paneAgentStateAtom, {
      "pane-1": {
        state: "idle",
        agentLabel: "Codex",
        source: "process",
        confidence: "medium",
        updatedAt: Date.now(),
        revision: 1,
      },
      "pane-2": {
        state: "idle",
        agentLabel: "Claude",
        source: "process",
        confidence: "medium",
        updatedAt: Date.now(),
        revision: 1,
      },
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <Provider store={store}>
          <TopTabs />
        </Provider>,
      );
    });

    // Idle badge is visible as a status indicator...
    expect(container.textContent).toContain("idle");
    // ...but it is NOT a jump control: no "Jump to" affordance exists.
    expect(container.querySelector('[aria-label="Jump to idle agent pane"]')).toBeNull();
    const idleBadge = container.querySelector('[aria-label="idle agent present"]') as HTMLElement;
    expect(idleBadge).not.toBeNull();
    expect(idleBadge.getAttribute("role")).toBeNull();

    // Clicking the passive indicator must not change pane focus.
    act(() => {
      idleBadge.click();
    });
    expect(store.get(openTabsAtom)[0].activePaneId).toBe("pane-1");
  });
});
