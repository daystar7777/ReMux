import { atom } from "jotai";
import type { AppConfig, Host, Profile } from "../types/config";
import type { TmuxPaneIdentity, TmuxSessionNode } from "../lib/ipc";
import { CONFIG_VERSION } from "../types/config";
import type { ClipboardSnapshot } from "../lib/clipboard";
import {
  hostAccount,
  loadConfig,
  saveConfig,
  secretsDelete,
  secretsSet,
} from "../lib/ipc";

export type PaneLayout =
  | { type: "leaf"; id: string; ptyId: string | null; tmuxIdentity?: TmuxPaneIdentity | null }
  | { type: "row" | "column"; id: string; children: PaneLayout[] };

export type MousePolicy = "remux" | "tmux";

export interface OpenTab {
  id: string;
  profileId: string;
  state: "idle" | "connecting" | "connected" | "warning" | "error" | "closed";
  bannerMessage?: string;
  rttMs?: number;
  missingTmuxRemote?: boolean;
  layout?: PaneLayout;
  activePaneId?: string;
  mousePolicy?: MousePolicy;
}

const emptyConfig = (): AppConfig => ({
  hosts: [],
  profiles: [],
  version: CONFIG_VERSION,
});

export const configAtom = atom<AppConfig>(emptyConfig());

export function pruneWorkspaceForConfig(
  tabs: OpenTab[],
  activeTabId: string | null,
  cfg: AppConfig,
): { tabs: OpenTab[]; activeTabId: string | null } {
  const validProfileIds = new Set(cfg.profiles.map((p) => p.id));
  const prunedTabs = tabs.filter((t) => validProfileIds.has(t.profileId));
  const prunedActiveTabId = prunedTabs.some((t) => t.id === activeTabId)
    ? activeTabId
    : prunedTabs.length
      ? prunedTabs[prunedTabs.length - 1].id
      : null;
  return { tabs: prunedTabs, activeTabId: prunedActiveTabId };
}

export const hydrateConfigAction = atom(null, async (_get, set) => {
  try {
    const loaded = (await loadConfig()) as AppConfig | null;
    let nextConfig: AppConfig;
    if (loaded && Array.isArray(loaded.hosts)) {
      nextConfig = {
        hosts: loaded.hosts,
        profiles: Array.isArray(loaded.profiles) ? loaded.profiles : [],
        version: loaded.version ?? CONFIG_VERSION,
      };
    } else {
      nextConfig = emptyConfig();
    }
    set(configAtom, nextConfig);
    const nextWorkspace = pruneWorkspaceForConfig(
      initialWorkspace.tabs,
      initialWorkspace.activeTabId,
      nextConfig,
    );
    set(baseOpenTabsAtom, nextWorkspace.tabs);
    set(baseActiveTabIdAtom, nextWorkspace.activeTabId);
    saveWorkspace(nextWorkspace.tabs, nextWorkspace.activeTabId);
  } catch (e) {
    console.warn("config load failed; using empty config", e);
    set(configAtom, emptyConfig());
    set(baseOpenTabsAtom, []);
    set(baseActiveTabIdAtom, null);
    saveWorkspace([], null);
  }
});

export const applyExternalConfigAction = atom(null, (_get, set, cfg: AppConfig) => {
  set(configAtom, cfg);
  const nextWorkspace = pruneWorkspaceForConfig(
    _get(baseOpenTabsAtom),
    _get(baseActiveTabIdAtom),
    cfg,
  );
  set(baseOpenTabsAtom, nextWorkspace.tabs);
  set(baseActiveTabIdAtom, nextWorkspace.activeTabId);
  saveWorkspace(nextWorkspace.tabs, nextWorkspace.activeTabId);
});

export const hostsAtom = atom(
  (get) => get(configAtom).hosts,
  (get, set, next: Host[]) => set(configAtom, { ...get(configAtom), hosts: next }),
);

export const profilesAtom = atom(
  (get) => get(configAtom).profiles,
  (get, set, next: Profile[]) => set(configAtom, { ...get(configAtom), profiles: next }),
);

export const sidebarCollapsedAtom = atom<boolean>(false);
export const inventorySidebarCollapsedAtom = atom<boolean>(false);

interface PersistedTab {
  id: string;
  profileId: string;
  layout?: PaneLayout;
  activePaneId?: string;
  mousePolicy?: MousePolicy;
}

interface PersistedWorkspace {
  tabs: PersistedTab[];
  activeTabId: string | null;
}

function cleanLayout(node: PaneLayout | undefined): PaneLayout | undefined {
  if (!node) return undefined;
  if (node.type === "leaf") {
    return { type: "leaf", id: node.id, ptyId: null, tmuxIdentity: null };
  } else {
    return {
      type: node.type,
      id: node.id,
      children: node.children.map(c => cleanLayout(c) as PaneLayout),
    };
  }
}

function getWorkspaceStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  if (typeof globalThis === "undefined" || !("localStorage" in globalThis)) {
    return null;
  }
  const storage = globalThis.localStorage;
  if (
    !storage ||
    typeof storage.getItem !== "function" ||
    typeof storage.setItem !== "function"
  ) {
    return null;
  }
  return storage;
}

export function saveWorkspace(tabs: OpenTab[], activeTabId: string | null) {
  const storage = getWorkspaceStorage();
  if (!storage) return;
  try {
    const persistedTabs = tabs.map((t) => ({
      id: t.id,
      profileId: t.profileId,
      layout: cleanLayout(t.layout),
      activePaneId: t.activePaneId,
      mousePolicy: t.mousePolicy ?? "remux",
    }));
    const ws: PersistedWorkspace = {
      tabs: persistedTabs,
      activeTabId,
    };
    storage.setItem("remux:workspace", JSON.stringify(ws));
  } catch (e) {
    console.warn("Failed to persist workspace settings", e);
  }
}

function loadWorkspace(): { tabs: OpenTab[]; activeTabId: string | null } {
  try {
    const storage = getWorkspaceStorage();
    if (!storage) return { tabs: [], activeTabId: null };
    const raw = storage.getItem("remux:workspace");
    if (!raw) return { tabs: [], activeTabId: null };
    const parsed = JSON.parse(raw) as PersistedWorkspace;
    if (!parsed || !Array.isArray(parsed.tabs)) return { tabs: [], activeTabId: null };
    const hydratedTabs = parsed.tabs.map((t) => ({
      id: t.id,
      profileId: t.profileId,
      state: "idle" as const,
      layout: t.layout,
      activePaneId: t.activePaneId,
      mousePolicy: t.mousePolicy ?? "remux",
    }));
    return {
      tabs: hydratedTabs,
      activeTabId: parsed.activeTabId,
    };
  } catch {
    return { tabs: [], activeTabId: null };
  }
}

const initialWorkspace = loadWorkspace();

const baseOpenTabsAtom = atom<OpenTab[]>(initialWorkspace.tabs);
export const openTabsAtom = atom(
  (get) => get(baseOpenTabsAtom),
  (get, set, update: OpenTab[] | ((prev: OpenTab[]) => OpenTab[])) => {
    const next = typeof update === "function" ? update(get(baseOpenTabsAtom)) : update;
    set(baseOpenTabsAtom, next);
    saveWorkspace(next, get(baseActiveTabIdAtom));
  }
);

const baseActiveTabIdAtom = atom<string | null>(initialWorkspace.activeTabId);
export const activeTabIdAtom = atom(
  (get) => get(baseActiveTabIdAtom),
  (get, set, update: string | null | ((prev: string | null) => string | null)) => {
    const next = typeof update === "function" ? update(get(baseActiveTabIdAtom)) : update;
    set(baseActiveTabIdAtom, next);
    saveWorkspace(get(baseOpenTabsAtom), next);
  }
);

export const tmuxHierarchyAtom = atom<Record<string, TmuxSessionNode[]>>({});

export interface PaneDiagnostics {
  memoryKb?: number;
  heartbeatStatus?: "stable" | "lagging" | "offline";
}

export const diagnosticsAtom = atom<Record<string, PaneDiagnostics>>({});

export const activeTabAtom = atom((get) => {
  const id = get(activeTabIdAtom);
  if (!id) return null;
  return get(openTabsAtom).find((t) => t.id === id) ?? null;
});

export const activeProfileAtom = atom((get) => {
  const tab = get(activeTabAtom);
  if (!tab) return null;
  return get(profilesAtom).find((p) => p.id === tab.profileId) ?? null;
});

export const activeHostAtom = atom((get) => {
  const p = get(activeProfileAtom);
  if (!p) return null;
  return get(hostsAtom).find((h) => h.id === p.host_id) ?? null;
});

export const clipboardAtom = atom<ClipboardSnapshot>({
  kind: "empty",
  byteLength: 0,
  lineCount: 0,
  preview: "",
  redacted: false,
});

export type ViewMode = "normal" | "focus" | "layout" | "readonly" | "follow" | "sync";

export const viewModeAtom = atom<ViewMode>("normal");

export const imeComposingAtom = atom<boolean>(false);

export const localeWarningAtom = atom<string | null>(null);

export const tmuxVersionLabelAtom = atom<string | null>(null);

export const mousePolicyAtom = atom(
  (get): MousePolicy => get(activeTabAtom)?.mousePolicy ?? "remux",
  (get, set, next: MousePolicy) => {
    const tab = get(activeTabAtom);
    if (!tab) return;
    set(
      openTabsAtom,
      get(openTabsAtom).map((t) =>
        t.id === tab.id ? { ...t, mousePolicy: next } : t,
      ),
    );
  },
);

export interface TmuxFallbackRequest {
  tabId: string;
  sessionName: string;
  exitCode: number | null;
}

export const tmuxFallbackRequestAtom = atom<TmuxFallbackRequest | null>(null);

export const openTabAction = atom(null, (get, set, profileId: string) => {
  const existing = get(openTabsAtom).find((t) => t.profileId === profileId);
  if (existing) {
    set(activeTabIdAtom, existing.id);
    return existing.id;
  }
  const tabId = `tab_${crypto.randomUUID()}`;
  const paneId = `pane_${crypto.randomUUID()}`;
  const tab: OpenTab = {
    id: tabId,
    profileId,
    state: "idle",
    layout: { type: "leaf", id: paneId, ptyId: null },
    activePaneId: paneId,
    mousePolicy: "remux",
  };
  set(openTabsAtom, [...get(openTabsAtom), tab]);
  set(activeTabIdAtom, tab.id);
  return tab.id;
});

export const closeTabAction = atom(null, (get, set, tabId: string) => {
  const tabs = get(openTabsAtom).filter((t) => t.id !== tabId);
  set(openTabsAtom, tabs);
  if (get(activeTabIdAtom) === tabId) {
    set(activeTabIdAtom, tabs.length ? tabs[tabs.length - 1].id : null);
  }
});

export const updateTabAction = atom(
  null,
  (get, set, payload: { id: string; patch: Partial<OpenTab> }) => {
    set(
      openTabsAtom,
      get(openTabsAtom).map((t) => (t.id === payload.id ? { ...t, ...payload.patch } : t)),
    );
  },
);

export const cycleTabAction = atom(
  null,
  (get, set, direction: "forward" | "backward") => {
    const tabs = get(openTabsAtom);
    if (tabs.length <= 1) return;
    const activeId = get(activeTabIdAtom);
    const currentIndex = tabs.findIndex((t) => t.id === activeId);
    if (currentIndex === -1) return;

    let nextIndex;
    if (direction === "backward") {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else {
      nextIndex = (currentIndex + 1) % tabs.length;
    }
    set(activeTabIdAtom, tabs[nextIndex].id);
  },
);

export interface HostSavePayload {
  host: Host;
  /** When non-null, the password is written to macOS Keychain at host:<id>.
   *  When null, REMUX leaves any existing Keychain entry untouched.
   *  When empty string, REMUX deletes any saved password. */
  password?: string | null;
}

export const addHostAction = atom(
  null,
  async (get, set, payload: HostSavePayload | Host) => {
    const wrapped: HostSavePayload =
      "host" in (payload as HostSavePayload)
        ? (payload as HostSavePayload)
        : { host: payload as Host };
    const current = get(configAtom);
    const next = { ...current, hosts: [...current.hosts, wrapped.host] };
    set(configAtom, next);
    await saveConfig(next);
    await persistHostSecret(wrapped);
  },
);

export const updateHostAction = atom(
  null,
  async (get, set, payload: HostSavePayload | Host) => {
    const wrapped: HostSavePayload =
      "host" in (payload as HostSavePayload)
        ? (payload as HostSavePayload)
        : { host: payload as Host };
    const current = get(configAtom);
    const next = {
      ...current,
      hosts: current.hosts.map((h) =>
        h.id === wrapped.host.id ? wrapped.host : h,
      ),
    };
    set(configAtom, next);
    await saveConfig(next);
    await persistHostSecret(wrapped);
  },
);

async function persistHostSecret(payload: HostSavePayload): Promise<void> {
  if (payload.password === undefined || payload.password === null) return;
  const account = hostAccount(payload.host.id);
  try {
    if (payload.password === "") {
      await secretsDelete(account);
    } else {
      await secretsSet(account, payload.password);
    }
  } catch (e) {
    console.warn("Keychain write failed", e);
  }
}

export const deleteHostAction = atom(null, async (get, set, hostId: string) => {
  const current = get(configAtom);
  const doomedProfileIds = new Set(
    current.profiles.filter((p) => p.host_id === hostId).map((p) => p.id),
  );
  const next = {
    ...current,
    hosts: current.hosts.filter((h) => h.id !== hostId),
    profiles: current.profiles.filter((p) => p.host_id !== hostId),
  };
  set(configAtom, next);

  const tabs = get(openTabsAtom).filter((t) => !doomedProfileIds.has(t.profileId));
  set(openTabsAtom, tabs);
  if (!tabs.find((t) => t.id === get(activeTabIdAtom))) {
    set(activeTabIdAtom, tabs.length ? tabs[tabs.length - 1].id : null);
  }

  await saveConfig(next);
  try {
    await secretsDelete(hostAccount(hostId));
  } catch (e) {
    console.warn("Keychain clear failed", e);
  }
});

export const addProfileAction = atom(null, async (get, set, profile: Profile) => {
  const current = get(configAtom);
  const next = { ...current, profiles: [...current.profiles, profile] };
  set(configAtom, next);
  await saveConfig(next);
});

export const updateProfileAction = atom(null, async (get, set, profile: Profile) => {
  const current = get(configAtom);
  const next = {
    ...current,
    profiles: current.profiles.map((p) => (p.id === profile.id ? profile : p)),
  };
  set(configAtom, next);
  await saveConfig(next);
});

export const deleteProfileAction = atom(null, async (get, set, profileId: string) => {
  const current = get(configAtom);
  const next = {
    ...current,
    profiles: current.profiles.filter((p) => p.id !== profileId),
  };
  set(configAtom, next);

  const tabs = get(openTabsAtom).filter((t) => t.profileId !== profileId);
  set(openTabsAtom, tabs);
  if (!tabs.find((t) => t.id === get(activeTabIdAtom))) {
    set(activeTabIdAtom, tabs.length ? tabs[tabs.length - 1].id : null);
  }

  await saveConfig(next);
});

export const inputBroadcastAtom = atom<Record<string, boolean>>({});

export const refreshPaneIdentitiesAction = atom(
  null,
  (get, set, payload: { tabId: string; sessionPanes: TmuxPaneIdentity[] }) => {
    const tabs = get(openTabsAtom);
    const tab = tabs.find((t) => t.id === payload.tabId);
    if (!tab || !tab.layout) return;

    const updateLayoutWithPaneIdentities = (
      node: PaneLayout,
      panes: TmuxPaneIdentity[],
      indexRef: { current: number }
    ): PaneLayout => {
      if (node.type === "leaf") {
        const identity = panes[indexRef.current] || null;
        indexRef.current += 1;
        return { ...node, tmuxIdentity: identity };
      }
      return {
        ...node,
        children: node.children.map((child) =>
          updateLayoutWithPaneIdentities(child, panes, indexRef)
        ),
      };
    };

    const indexRef = { current: 0 };
    const nextLayout = updateLayoutWithPaneIdentities(tab.layout, payload.sessionPanes, indexRef);

    set(
      openTabsAtom,
      tabs.map((t) => (t.id === payload.tabId ? { ...t, layout: nextLayout } : t))
    );
  }
);

export const splitPaneAction = atom(
  null,
  (get, set, payload: { tabId: string; paneId: string; direction: "row" | "column" }) => {
    const tabs = get(openTabsAtom);
    const tab = tabs.find((t) => t.id === payload.tabId);
    if (!tab || !tab.layout) return null;

    const newPaneId = `pane_${crypto.randomUUID()}`;
    const newLeaf: PaneLayout = { type: "leaf", id: newPaneId, ptyId: null };

    const updateLayout = (node: PaneLayout): PaneLayout => {
      if (node.type === "leaf") {
        if (node.id === payload.paneId) {
          return {
            type: payload.direction,
            id: `split_${crypto.randomUUID()}`,
            children: [
              { ...node },
              newLeaf,
            ],
          };
        }
        return node;
      } else {
        return {
          ...node,
          children: node.children.map(updateLayout),
        };
      }
    };

    const nextLayout = updateLayout(tab.layout);
    set(
      openTabsAtom,
      tabs.map((t) => {
        if (t.id === payload.tabId) {
          return {
            ...t,
            layout: nextLayout,
            activePaneId: newPaneId,
          };
        }
        return t;
      }),
    );

    return newPaneId;
  },
);

export const closePaneAction = atom(
  null,
  (get, set, payload: { tabId: string; paneId: string }) => {
    const tabs = get(openTabsAtom);
    const tab = tabs.find((t) => t.id === payload.tabId);
    if (!tab || !tab.layout) return;

    const removeLeaf = (node: PaneLayout): PaneLayout | null => {
      if (node.type === "leaf") {
        if (node.id === payload.paneId) {
          return null;
        }
        return node;
      }

      const nextChildren = node.children
        .map(removeLeaf)
        .filter((c): c is PaneLayout => c !== null);

      if (nextChildren.length === 0) {
        return null;
      }
      if (nextChildren.length === 1) {
        return nextChildren[0];
      }
      return {
        ...node,
        children: nextChildren,
      };
    };

    const nextLayout = removeLeaf(tab.layout);
    if (!nextLayout) {
      set(closeTabAction, payload.tabId);
      return;
    }

    const findFirstLeaf = (node: PaneLayout): string => {
      if (node.type === "leaf") return node.id;
      return findFirstLeaf(node.children[0]);
    };

    let nextActivePaneId = tab.activePaneId;
    if (tab.activePaneId === payload.paneId) {
      nextActivePaneId = findFirstLeaf(nextLayout);
    }

    set(
      openTabsAtom,
      tabs.map((t) => {
        if (t.id === payload.tabId) {
          return {
            ...t,
            layout: nextLayout,
            activePaneId: nextActivePaneId,
          };
        }
        return t;
      }),
    );
  },
);

function buildEvenGrid(leaves: PaneLayout[], direction: "row" | "column" = "column"): PaneLayout {
  if (leaves.length === 0) return { type: "leaf", id: `pane_${crypto.randomUUID()}`, ptyId: null };
  if (leaves.length === 1) return leaves[0];
  const mid = Math.ceil(leaves.length / 2);
  const leftLeaves = leaves.slice(0, mid);
  const rightLeaves = leaves.slice(mid);
  const nextDir = direction === "column" ? "row" : "column";
  return {
    type: direction,
    id: `split_${crypto.randomUUID()}`,
    children: [
      buildEvenGrid(leftLeaves, nextDir),
      buildEvenGrid(rightLeaves, nextDir)
    ]
  };
}

function buildMainLeft(leaves: PaneLayout[]): PaneLayout {
  if (leaves.length === 0) return { type: "leaf", id: `pane_${crypto.randomUUID()}`, ptyId: null };
  if (leaves.length === 1) return leaves[0];
  const first = leaves[0];
  const rest = leaves.slice(1);
  
  const buildVerticalStack = (nodes: PaneLayout[]): PaneLayout => {
    if (nodes.length === 1) return nodes[0];
    return {
      type: "row",
      id: `split_${crypto.randomUUID()}`,
      children: [nodes[0], buildVerticalStack(nodes.slice(1))]
    };
  };

  return {
    type: "column",
    id: `split_${crypto.randomUUID()}`,
    children: [first, buildVerticalStack(rest)]
  };
}

function buildMainTop(leaves: PaneLayout[]): PaneLayout {
  if (leaves.length === 0) return { type: "leaf", id: `pane_${crypto.randomUUID()}`, ptyId: null };
  if (leaves.length === 1) return leaves[0];
  const first = leaves[0];
  const rest = leaves.slice(1);

  const buildHorizontalStack = (nodes: PaneLayout[]): PaneLayout => {
    if (nodes.length === 1) return nodes[0];
    return {
      type: "column",
      id: `split_${crypto.randomUUID()}`,
      children: [nodes[0], buildHorizontalStack(nodes.slice(1))]
    };
  };

  return {
    type: "row",
    id: `split_${crypto.randomUUID()}`,
    children: [first, buildHorizontalStack(rest)]
  };
}

export const applyPresetAction = atom(
  null,
  (get, set, payload: { tabId: string; preset: "even" | "main-left" | "main-top" }) => {
    const tabs = get(openTabsAtom);
    const tab = tabs.find((t) => t.id === payload.tabId);
    if (!tab || !tab.layout) return;

    const collectLeaves = (node: PaneLayout): PaneLayout[] => {
      if (node.type === "leaf") return [node];
      return node.children.flatMap(collectLeaves);
    };

    const leaves = collectLeaves(tab.layout);
    if (leaves.length <= 1) return;

    let nextLayout: PaneLayout;
    if (payload.preset === "even") {
      nextLayout = buildEvenGrid(leaves);
    } else if (payload.preset === "main-left") {
      nextLayout = buildMainLeft(leaves);
    } else if (payload.preset === "main-top") {
      nextLayout = buildMainTop(leaves);
    } else {
      return;
    }

    set(
      openTabsAtom,
      tabs.map((t) => (t.id === payload.tabId ? { ...t, layout: nextLayout } : t))
    );
  }
);


export const cyclePaneAction = atom(
  null,
  (get, set, direction: "forward" | "backward" = "forward") => {
    const tab = get(activeTabAtom);
    if (!tab || !tab.layout) return;

    const collectLeaves = (node: PaneLayout): string[] => {
      if (node.type === "leaf") return [node.id];
      return node.children.flatMap(collectLeaves);
    };

    const leaves = collectLeaves(tab.layout);
    if (leaves.length <= 1) return;

    const currentIndex = leaves.indexOf(tab.activePaneId ?? "");
    if (currentIndex === -1) return;

    let nextIndex;
    if (direction === "backward") {
      nextIndex = (currentIndex - 1 + leaves.length) % leaves.length;
    } else {
      nextIndex = (currentIndex + 1) % leaves.length;
    }
    const nextPaneId = leaves[nextIndex];

    set(
      openTabsAtom,
      get(openTabsAtom).map((t) => {
        if (t.id === tab.id) {
          return { ...t, activePaneId: nextPaneId };
        }
        return t;
      }),
    );
  },
);

export interface TerminalAppearance {
  themeName: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  fontFamily: string;
  zoom: number; // multiplier e.g. 0.8 to 1.5
}

export const DEFAULT_APPEARANCE: TerminalAppearance = {
  themeName: "Remux Dark",
  fontSize: 13,
  lineHeight: 1.2,
  letterSpacing: 0,
  fontFamily: '"SF Mono", Menlo, "DejaVu Sans Mono", "Apple SD Gothic Neo", "Noto Sans Mono CJK KR", monospace',
  zoom: 1.0,
};

function loadAppearance(): TerminalAppearance {
  try {
    const storage = getAppearanceStorage();
    if (!storage) return DEFAULT_APPEARANCE;
    const raw = storage.getItem("remux:appearance");
    if (!raw) return DEFAULT_APPEARANCE;
    const parsed = JSON.parse(raw);
    return {
      themeName: parsed.themeName ?? DEFAULT_APPEARANCE.themeName,
      fontSize: typeof parsed.fontSize === "number" ? parsed.fontSize : DEFAULT_APPEARANCE.fontSize,
      lineHeight: typeof parsed.lineHeight === "number" ? parsed.lineHeight : DEFAULT_APPEARANCE.lineHeight,
      letterSpacing: typeof parsed.letterSpacing === "number" ? parsed.letterSpacing : DEFAULT_APPEARANCE.letterSpacing,
      fontFamily: parsed.fontFamily ?? DEFAULT_APPEARANCE.fontFamily,
      zoom: typeof parsed.zoom === "number" ? parsed.zoom : DEFAULT_APPEARANCE.zoom,
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

function getAppearanceStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  if (typeof globalThis === "undefined" || !("localStorage" in globalThis)) {
    return null;
  }
  const storage = globalThis.localStorage;
  if (
    !storage ||
    typeof storage.getItem !== "function" ||
    typeof storage.setItem !== "function"
  ) {
    return null;
  }
  return storage;
}

export const appearanceAtom = atom<TerminalAppearance>(loadAppearance());

export const rightPanelOpenAtom = atom<boolean>(false);

export const updateAppearanceAction = atom(
  null,
  (get, set, patch: Partial<TerminalAppearance>) => {
    const next = { ...get(appearanceAtom), ...patch };
    set(appearanceAtom, next);
    const storage = getAppearanceStorage();
    if (!storage) return;
    try {
      storage.setItem("remux:appearance", JSON.stringify(next));
    } catch (e) {
      console.warn("Failed to persist appearance settings", e);
    }
  }
);

function getIntervalStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  if (typeof globalThis === "undefined" || !("localStorage" in globalThis)) {
    return null;
  }
  return globalThis.localStorage;
}

function loadTelemetryInterval(): number {
  try {
    const storage = getIntervalStorage();
    if (!storage) return 5000;
    const raw = storage.getItem("remux:telemetry-interval");
    if (raw === null) return 5000;
    const val = parseInt(raw, 10);
    return isNaN(val) ? 5000 : val;
  } catch {
    return 5000;
  }
}

function loadHierarchyInterval(): number {
  try {
    const storage = getIntervalStorage();
    if (!storage) return 8000;
    const raw = storage.getItem("remux:hierarchy-interval");
    if (raw === null) return 8000;
    const val = parseInt(raw, 10);
    return isNaN(val) ? 8000 : val;
  } catch {
    return 8000;
  }
}

const baseTelemetryIntervalAtom = atom<number>(loadTelemetryInterval());
export const telemetryIntervalAtom = atom(
  (get) => get(baseTelemetryIntervalAtom),
  (_get, set, update: number) => {
    set(baseTelemetryIntervalAtom, update);
    const storage = getIntervalStorage();
    if (storage) {
      try {
        storage.setItem("remux:telemetry-interval", String(update));
      } catch (e) {
        console.warn("Failed to persist telemetry interval", e);
      }
    }
  }
);

const baseHierarchyIntervalAtom = atom<number>(loadHierarchyInterval());
export const hierarchyIntervalAtom = atom(
  (get) => get(baseHierarchyIntervalAtom),
  (_get, set, update: number) => {
    set(baseHierarchyIntervalAtom, update);
    const storage = getIntervalStorage();
    if (storage) {
      try {
        storage.setItem("remux:hierarchy-interval", String(update));
      } catch (e) {
        console.warn("Failed to persist hierarchy interval", e);
      }
    }
  }
);
