import { atom } from "jotai";
import type { AppConfig, Host, Profile } from "../types/config";
import type { TmuxPaneIdentity, TmuxSessionNode } from "../lib/ipc";
import { CONFIG_VERSION } from "../types/config";
import type { ClipboardSnapshot } from "../lib/clipboard";
import {
  buildProcessAgentState,
  markAgentOutput,
} from "../lib/agentDetection";
import {
  acknowledgeDoneState,
  collectPaneIdsFromLayout,
  pickNavigableAgentPane,
  type PaneAgentState,
} from "../lib/agentState";
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
  ephemeralProfile?: Profile;
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
  const prunedTabs = tabs.filter((t) => t.ephemeralProfile || validProfileIds.has(t.profileId));
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

export function recoverLeafForEmptyLayout(
  previousLeaf?: Extract<PaneLayout, { type: "leaf" }> | null,
  fallbackPaneId?: string,
): Extract<PaneLayout, { type: "leaf" }> {
  if (previousLeaf) return { ...previousLeaf, ptyId: null, tmuxIdentity: null };
  if (fallbackPaneId && fallbackPaneId.trim()) {
    return { type: "leaf", id: fallbackPaneId, ptyId: null, tmuxIdentity: null };
  }
  return { type: "leaf", id: `pane_${crypto.randomUUID()}`, ptyId: null, tmuxIdentity: null };
}

function warnLayoutRecovery(reason: string) {
  console.warn(`[REMUX] Recovered malformed persisted layout: ${reason}`);
}

function firstLeafId(node: PaneLayout | undefined): string | null {
  if (!node) return null;
  if (node.type === "leaf") return node.id;
  for (const child of node.children) {
    const found = firstLeafId(child);
    if (found) return found;
  }
  return null;
}

function hasLeafId(node: PaneLayout | undefined, paneId: string | undefined): boolean {
  if (!node || !paneId) return false;
  if (node.type === "leaf") return node.id === paneId;
  return node.children.some((child) => hasLeafId(child, paneId));
}

export function sanitizePersistedLayout(
  node: unknown,
  activePaneId?: string,
): PaneLayout | undefined {
  if (!node || typeof node !== "object") {
    if (activePaneId) warnLayoutRecovery("missing root; recovered active pane id");
    return activePaneId ? recoverLeafForEmptyLayout(null, activePaneId) : undefined;
  }
  const candidate = node as Partial<PaneLayout> & { children?: unknown };
  if (candidate.type === "leaf") {
    if (typeof candidate.id === "string" && candidate.id.trim()) {
      return { type: "leaf", id: candidate.id, ptyId: null, tmuxIdentity: null };
    }
    if (activePaneId) warnLayoutRecovery("malformed leaf id; recovered active pane id");
    return activePaneId ? recoverLeafForEmptyLayout(null, activePaneId) : undefined;
  }
  if (candidate.type === "row" || candidate.type === "column") {
    const rawChildren = Array.isArray(candidate.children) ? candidate.children : [];
    const children = Array.isArray(candidate.children)
      ? candidate.children
          .map((child) => sanitizePersistedLayout(child))
          .filter((child): child is PaneLayout => Boolean(child))
      : [];
    if (children.length < rawChildren.length || !Array.isArray(candidate.children)) {
      warnLayoutRecovery("pruned malformed branch children");
    }
    if (children.length === 0) {
      if (activePaneId) warnLayoutRecovery("empty branch; recovered active pane id");
      return activePaneId ? recoverLeafForEmptyLayout(null, activePaneId) : undefined;
    }
    return {
      type: candidate.type,
      id: typeof candidate.id === "string" && candidate.id.trim()
        ? candidate.id
        : `split_${crypto.randomUUID()}`,
      children,
    };
  }
  if (activePaneId) warnLayoutRecovery("unknown node type; recovered active pane id");
  return activePaneId ? recoverLeafForEmptyLayout(null, activePaneId) : undefined;
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
    const persistedTabs = tabs
      .filter((t) => !t.ephemeralProfile)
      .map((t) => ({
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
    const hydratedTabs = parsed.tabs.map((t) => {
      const layout = sanitizePersistedLayout(t.layout, t.activePaneId);
      const activePaneId = hasLeafId(layout, t.activePaneId)
        ? t.activePaneId
        : firstLeafId(layout) ?? t.activePaneId;
      return {
        id: t.id,
        profileId: t.profileId,
        state: "idle" as const,
        layout,
        activePaneId,
        mousePolicy: t.mousePolicy ?? "remux",
      };
    });
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

export const paneAgentStateAtom = atom<Record<string, PaneAgentState>>({});

export const markPaneAgentOutputAction = atom(null, (get, set, paneId: string) => {
  const current = get(paneAgentStateAtom);
  const next = markAgentOutput(current[paneId], Date.now());
  if (!next) return;
  set(paneAgentStateAtom, {
    ...current,
    [paneId]: next,
  });
});

export const acknowledgePaneAgentDoneAction = atom(null, (get, set, paneId: string) => {
  const current = get(paneAgentStateAtom);
  const next = acknowledgeDoneState(current[paneId]);
  if (!next || next === current[paneId]) return;
  set(paneAgentStateAtom, {
    ...current,
    [paneId]: next,
  });
});

export const activateAgentPaneAction = atom(
  null,
  (get, set, payload?: { tabId?: string }): string | null => {
    const tabs = get(openTabsAtom);
    const targetTabId = payload?.tabId ?? get(activeTabIdAtom);
    const tab = tabs.find((t) => t.id === targetTabId);
    if (!tab?.layout) return null;

    const paneId = pickNavigableAgentPane(
      collectPaneIdsFromLayout(tab.layout),
      get(paneAgentStateAtom),
    );
    if (!paneId) return null;

    set(activeTabIdAtom, tab.id);
    set(
      openTabsAtom,
      tabs.map((t) => (t.id === tab.id ? { ...t, activePaneId: paneId } : t)),
    );
    set(acknowledgePaneAgentDoneAction, paneId);
    return paneId;
  },
);

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
  if (tab.ephemeralProfile) return tab.ephemeralProfile;
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
    if (existing.state === "error" || existing.state === "warning" || existing.state === "closed" || existing.state === "connecting") {
      set(
        openTabsAtom,
        get(openTabsAtom).map((t) =>
          t.id === existing.id ? { ...t, state: "idle" as const, bannerMessage: undefined } : t,
        ),
      );
    }
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

export const openEphemeralTabAction = atom(null, (get, set, profile: Profile) => {
  const existingSaved = get(profilesAtom).find(
    (p) =>
      p.host_id === profile.host_id &&
      p.tmux_session_name === profile.tmux_session_name &&
      (p.tmux_window_target || "") === (profile.tmux_window_target || ""),
  );
  if (existingSaved) {
    return set(openTabAction, existingSaved.id);
  }

  const existing = get(openTabsAtom).find(
    (t) =>
      t.ephemeralProfile?.host_id === profile.host_id &&
      t.ephemeralProfile.tmux_session_name === profile.tmux_session_name &&
      (t.ephemeralProfile.tmux_window_target || "") === (profile.tmux_window_target || ""),
  );
  if (existing) {
    set(activeTabIdAtom, existing.id);
    return existing.id;
  }

  const tabId = `tab_${crypto.randomUUID()}`;
  const paneId = `pane_${crypto.randomUUID()}`;
  const tab: OpenTab = {
    id: tabId,
    profileId: profile.id,
    ephemeralProfile: profile,
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
    const exists = current.hosts.some((h) => h.id === wrapped.host.id);
    const nextHosts = exists
      ? current.hosts.map((h) => (h.id === wrapped.host.id ? wrapped.host : h))
      : [...current.hosts, wrapped.host];
    const next = { ...current, hosts: nextHosts };
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
  const exists = current.profiles.some((p) => p.id === profile.id);
  const nextProfiles = exists
    ? current.profiles.map((p) => (p.id === profile.id ? profile : p))
    : [...current.profiles, profile];
  const next = { ...current, profiles: nextProfiles };
  set(configAtom, next);
  await saveConfig(next);
});

export const updateEphemeralProfileAction = atom(
  null,
  (get, set, payload: { tabId: string; profile: Profile }) => {
    set(
      openTabsAtom,
      get(openTabsAtom).map((t) =>
        t.id === payload.tabId
          ? { ...t, profileId: payload.profile.id, ephemeralProfile: payload.profile }
          : t,
      ),
    );
  },
);

export const pinEphemeralTabAction = atom(null, async (get, set, tabId: string) => {
  const tab = get(openTabsAtom).find((t) => t.id === tabId);
  if (!tab?.ephemeralProfile) return null;

  const current = get(configAtom);
  const existing = current.profiles.find((p) => p.id === tab.ephemeralProfile?.id);
  const nextConfig = existing
    ? current
    : { ...current, profiles: [...current.profiles, tab.ephemeralProfile] };

  if (!existing) {
    set(configAtom, nextConfig);
    await saveConfig(nextConfig);
  }

  set(
    openTabsAtom,
    get(openTabsAtom).map((t) =>
      t.id === tabId ? { ...t, profileId: tab.ephemeralProfile!.id, ephemeralProfile: undefined } : t,
    ),
  );
  return tab.ephemeralProfile.id;
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

// Pure helper: rewrite the tmux session target for every profile on `hostId` that
// targets `fromSession`. Returns a new profiles array when something changed, or
// null when nothing matched (so callers can skip a redundant save). Per the locked
// naming decision this only touches the connection target (`tmux_session_name`);
// the user's `display_alias` is a local label and is never rewritten here.
export function migrateSessionInProfiles(
  profiles: Profile[],
  hostId: string,
  fromSession: string,
  toSession: string,
): Profile[] | null {
  if (!toSession || fromSession === toSession) return null;
  let changed = false;
  const next = profiles.map((p) => {
    if (p.host_id === hostId && p.tmux_session_name === fromSession) {
      changed = true;
      return { ...p, tmux_session_name: toSession };
    }
    return p;
  });
  return changed ? next : null;
}

// When a tmux session is renamed, every profile that targets that session on the
// same host must follow the rename or it silently breaks (next open would
// attach-or-create a fresh empty session under the stale name).
export const migrateSessionRenameAction = atom(
  null,
  async (
    get,
    set,
    payload: { hostId: string; fromSession: string; toSession: string },
  ) => {
    const current = get(configAtom);
    const nextProfiles = migrateSessionInProfiles(
      current.profiles,
      payload.hostId,
      payload.fromSession,
      payload.toSession,
    );
    if (!nextProfiles) return;
    const next = { ...current, profiles: nextProfiles };
    set(configAtom, next);
    await saveConfig(next);
  },
);

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
    const agentState = { ...get(paneAgentStateAtom) };
    const now = Date.now();
    const nextLayout = updateLayoutWithPaneIdentities(tab.layout, payload.sessionPanes, indexRef);
    const updateAgentStateFromLayout = (node: PaneLayout) => {
      if (node.type === "leaf") {
        const nextAgentState = buildProcessAgentState({
          command: node.tmuxIdentity?.paneCurrentCommand,
          previous: agentState[node.id],
          now,
        });
        if (nextAgentState) {
          agentState[node.id] = nextAgentState;
        }
        return;
      }
      node.children.forEach(updateAgentStateFromLayout);
    };
    updateAgentStateFromLayout(nextLayout);

    set(
      openTabsAtom,
      tabs.map((t) => (t.id === payload.tabId ? { ...t, layout: nextLayout } : t))
    );
    set(paneAgentStateAtom, agentState);
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

function buildEvenGrid(
  leaves: PaneLayout[],
  direction: "row" | "column" = "column",
  previousLeaf?: Extract<PaneLayout, { type: "leaf" }> | null,
): PaneLayout {
  if (leaves.length === 0) return recoverLeafForEmptyLayout(previousLeaf);
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

function buildMainLeft(leaves: PaneLayout[], previousLeaf?: Extract<PaneLayout, { type: "leaf" }> | null): PaneLayout {
  if (leaves.length === 0) return recoverLeafForEmptyLayout(previousLeaf);
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

function buildMainTop(leaves: PaneLayout[], previousLeaf?: Extract<PaneLayout, { type: "leaf" }> | null): PaneLayout {
  if (leaves.length === 0) return recoverLeafForEmptyLayout(previousLeaf);
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
  macOptionIsMeta: boolean;
}

export const DEFAULT_APPEARANCE: TerminalAppearance = {
  themeName: "Remux Dark",
  fontSize: 13,
  lineHeight: 1.2,
  letterSpacing: 0,
  fontFamily: '"SF Mono", Menlo, "DejaVu Sans Mono", "Apple SD Gothic Neo", "Noto Sans Mono CJK KR", monospace',
  zoom: 1.0,
  macOptionIsMeta: false,
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
      macOptionIsMeta: typeof parsed.macOptionIsMeta === "boolean" ? parsed.macOptionIsMeta : DEFAULT_APPEARANCE.macOptionIsMeta,
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
