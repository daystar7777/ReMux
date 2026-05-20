import { useEffect, useMemo, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Sidebar } from "./components/Sidebar";
import { TopTabs } from "./components/TopTabs";
import { StatusLine } from "./components/StatusLine";
import { TerminalHandle } from "./components/Terminal";
import { TerminalGrid } from "./components/TerminalGrid";
import { PasteGuardModal } from "./components/PasteGuardModal";
import { FingerprintModal } from "./components/FingerprintModal";
import { TmuxFallbackModal } from "./components/TmuxFallbackModal";
import { MissingTmuxModal } from "./components/MissingTmuxModal";
import { RenameWindowModal } from "./components/RenameWindowModal";
import { AppearancePanel } from "./components/AppearancePanel";
import { ExternalLink } from "lucide-react";
import {
  activeHostAtom,
  activeProfileAtom,
  activeTabAtom,
  applyExternalConfigAction,
  applyPresetAction,
  clipboardAtom,
  closePaneAction,
  closeTabAction,
  cyclePaneAction,
  cycleTabAction,
  diagnosticsAtom,
  hostsAtom,
  updateHostAction,
  hydrateConfigAction,
  inputBroadcastAtom,
  localeWarningAtom,
  mousePolicyAtom,
  openTabsAtom,
  PaneLayout,
  profilesAtom,
  tmuxFallbackRequestAtom,
  tmuxHierarchyAtom,
  tmuxVersionLabelAtom,
  updateProfileAction,
  updateTabAction,
  viewModeAtom,
  sidebarCollapsedAtom,
  inventorySidebarCollapsedAtom,
  rightPanelOpenAtom,
  telemetryIntervalAtom,
  hierarchyIntervalAtom,
  refreshPaneIdentitiesAction,
  splitPaneAction,
} from "./state/atoms";
import type { AppConfig, Host } from "./types/config";
import {
  getProcessMemory,
  hostAccount,
  ptyKill,
  ptyResize,
  ptySpawnLocal,
  ptySpawnSshTmux,
  ptySpawnTmuxLocal,
  ptyWrite,
  type PtyEvent,
  secretsGet,
  tmuxListLocalPanes,
  tmuxListRemotePanes,
  tmuxLocalVersion,
  tmuxProbeHierarchy,
  type TmuxPaneIdentity,
  type TmuxLayoutPreset,
  tmuxSplitLocalPane,
  tmuxKillLocalPane,
  tmuxSelectLocalPane,
  tmuxZoomLocalPane,
  tmuxSelectLocalLayout,
  tmuxSplitRemotePane,
  tmuxKillRemotePane,
  tmuxSelectRemotePane,
  tmuxZoomRemotePane,
  tmuxSelectRemoteLayout,
  tmuxRenameLocalPane,
  tmuxRenameLocalWindow,
  tmuxRenameRemotePane,
  tmuxRenameRemoteWindow,
  tmuxSetLocalMouse,
  tmuxSetRemoteMouse,
  probeRemoteEnv,
  clipboardRead,
  tmuxNewLocalWindow,
  tmuxKillLocalWindow,
  tmuxNewRemoteWindow,
  tmuxKillRemoteWindow,
} from "./lib/ipc";
import { InventorySidebar } from "./components/InventorySidebar";
import { invoke } from "@tauri-apps/api/core";
import { summarize } from "./lib/clipboard";
import { formatRemoteLocaleWarning } from "./lib/locale";
import { nativeTmuxDisabledReason, supportsNativeTmuxCommands } from "./lib/remotePolicy";

interface PendingPaste {
  text: string;
  resolve: (accept: boolean) => void;
}

interface FingerprintRequest {
  host: string;
  fingerprintBlock: string;
  resolve: (accept: boolean) => void;
}

interface SessionBinding {
  tabId: string;
  paneId: string;
  sessionId: string;
  kind: "tmux" | "raw";
}

interface RenameWindowRequest {
  kind: "window" | "pane" | "window-direct";
  paneId?: string;
  target?: string;
  currentName: string;
  identityLabel: string;
}

const remoteSshArgs = (host: Host) => ({
  host: host.address,
  user: host.username || undefined,
  port: host.port || undefined,
  sshConfigAlias: host.ssh_config_alias,
  keyPath: host.key_path,
  proxyJump: host.proxy_jump,
  identityAgent: host.identity_agent,
  skipHostKeyCheck: host.skip_host_key_check,
  passwordAuth: host.auth_method === "password",
});

export default function App() {
  type TmuxCommand = "select" | "split" | "kill" | "zoom";
  type TmuxSplitDirection = "row" | "column";

  const tabs = useAtomValue(openTabsAtom);
  const activeTab = useAtomValue(activeTabAtom);
  const activeProfile = useAtomValue(activeProfileAtom);
  const activeHost = useAtomValue(activeHostAtom);
  const hosts = useAtomValue(hostsAtom);
  const profiles = useAtomValue(profilesAtom);
  const updateTab = useSetAtom(updateTabAction);
  const updateHost = useSetAtom(updateHostAction);
  const closeTab = useSetAtom(closeTabAction);
  const [viewMode, setViewMode] = useAtom(viewModeAtom);
  const setLocaleWarning = useSetAtom(localeWarningAtom);
  const [tmuxVersionLabel, setTmuxVersionLabel] = useAtom(tmuxVersionLabelAtom);
  const [fallbackReq, setFallbackReq] = useAtom(tmuxFallbackRequestAtom);
  const hydrateConfig = useSetAtom(hydrateConfigAction);
  const applyExternalConfig = useSetAtom(applyExternalConfigAction);
  const cycleTab = useSetAtom(cycleTabAction);
  const cyclePane = useSetAtom(cyclePaneAction);
  const closePane = useSetAtom(closePaneAction);
  const splitPane = useSetAtom(splitPaneAction);
  const applyPreset = useSetAtom(applyPresetAction);
  const setHierarchyRecord = useSetAtom(tmuxHierarchyAtom);
  const setDiagnostics = useSetAtom(diagnosticsAtom);
  const updateProfile = useSetAtom(updateProfileAction);
  const refreshPaneIdentities = useSetAtom(refreshPaneIdentitiesAction);
  const setClipboard = useSetAtom(clipboardAtom);

  const [, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom);
  const [, setInventorySidebarCollapsed] = useAtom(inventorySidebarCollapsedAtom);
  const [, setRightPanelOpen] = useAtom(rightPanelOpenAtom);
  const telemetryInterval = useAtomValue(telemetryIntervalAtom);
  const hierarchyInterval = useAtomValue(hierarchyIntervalAtom);
  const [mousePolicy, setMousePolicy] = useAtom(mousePolicyAtom);

  const termHandlesRef = useRef<Map<string, TerminalHandle>>(new Map());
  const viewModeRef = useRef(viewMode);
  const tabsRef = useRef(tabs);
  const [pendingPaste, setPendingPaste] = useState<PendingPaste | null>(null);
  const [fingerprintReq, setFingerprintReq] = useState<FingerprintRequest | null>(null);
  const [missingTmuxReq, setMissingTmuxReq] = useState<{ tabId: string; isLocal: boolean } | null>(null);
  const [renameWindowReq, setRenameWindowReq] = useState<RenameWindowRequest | null>(null);
  const [disconnectedPanes, setDisconnectedPanes] = useState<Map<string, {
    countdown: number;
    retryCount: number;
    bannerMessage?: string;
  }>>(new Map());
  
  // Track bindings via paneId instead of tabId
  const bindingsRef = useRef<Map<string, SessionBinding>>(new Map());

  // Input broadcasting
  const broadcastRecord = useAtomValue(inputBroadcastAtom);
  const isBroadcast = activeTab ? !!broadcastRecord[activeTab.id] : false;
  const nativeTmuxDisabledReasonForActiveHost = (action = "Native tmux commands") =>
    nativeTmuxDisabledReason(activeHost, action);

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    void hydrateConfig();
  }, [hydrateConfig]);

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let lastRaw: string | null = null;

    const syncClipboardPreview = async () => {
      if (disposed || inFlight) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const raw = await clipboardRead();
        if (!disposed && raw !== lastRaw) {
          lastRaw = raw;
          setClipboard(summarize(raw));
        }
      } catch {
        // Clipboard access can be denied by the OS or unavailable in tests.
      } finally {
        inFlight = false;
      }
    };

    void syncClipboardPreview();
    const interval = window.setInterval(() => void syncClipboardPreview(), 1500);
    const onFocus = () => void syncClipboardPreview();
    const onVisibility = () => void syncClipboardPreview();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [setClipboard]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. Tab cycling (Ctrl + Tab) vs Pane cycling (Ctrl + Shift + Tab)
      if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) {
          cyclePane("forward");
        } else {
          cycleTab("forward");
        }
        return;
      }

      // 2. Pane cycling fallback: Ctrl + ` (backtick)
      if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        e.stopPropagation();
        cyclePane(e.shiftKey ? "backward" : "forward");
        return;
      }

      // 3. Command Key binds (Cmd on Mac, standard OS-level keys)
      if (e.metaKey || e.ctrlKey) {
        const keyLower = e.key.toLowerCase();
        
        // Cmd + B toggles primary sidebar
        if (!e.shiftKey && !e.altKey && keyLower === "b") {
          e.preventDefault();
          e.stopPropagation();
          setSidebarCollapsed((prev) => !prev);
          return;
        }

        // Cmd + Shift + I toggles inventory sidebar
        if (e.shiftKey && !e.altKey && keyLower === "i") {
          e.preventDefault();
          e.stopPropagation();
          setInventorySidebarCollapsed((prev) => !prev);
          return;
        }

        // Cmd + , toggles appearance panel
        if (!e.shiftKey && !e.altKey && e.key === ",") {
          e.preventDefault();
          e.stopPropagation();
          setRightPanelOpen((prev) => !prev);
          return;
        }
      }

      // 5. Ctrl+Shift+E, Ctrl+Shift+D, Ctrl+Shift+W split and close shortcuts
      if (e.ctrlKey && e.shiftKey) {
        const keyUpper = e.key.toUpperCase();
        if (keyUpper === "E") {
          if (activeTab?.activePaneId) {
            e.preventDefault();
            e.stopPropagation();
            void handleSplitPane(activeTab.activePaneId, "column");
          }
          return;
        }
        if (keyUpper === "D") {
          if (activeTab?.activePaneId) {
            e.preventDefault();
            e.stopPropagation();
            void handleSplitPane(activeTab.activePaneId, "row");
          }
          return;
        }
        if (keyUpper === "W") {
          if (activeTab?.activePaneId) {
            e.preventDefault();
            e.stopPropagation();
            void handleClosePane(activeTab.activePaneId);
          }
          return;
        }
      }

      // 4. Directional Pane Jumping: Cmd+Alt+Arrow or Ctrl+Alt+Arrow
      const isAlt = e.altKey;
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (isAlt && isCmdOrCtrl) {
        let dir: "up" | "down" | "left" | "right" | null = null;
        if (e.key === "ArrowUp") dir = "up";
        else if (e.key === "ArrowDown") dir = "down";
        else if (e.key === "ArrowLeft") dir = "left";
        else if (e.key === "ArrowRight") dir = "right";

        if (dir) {
          e.preventDefault();
          e.stopPropagation();
          spatialJump(dir);
        }
      }
    };

    const spatialJump = (dir: "up" | "down" | "left" | "right") => {
      const activeEl = document.querySelector(".terminal-pane-wrapper.active");
      if (!activeEl) return;
      const activeRect = activeEl.getBoundingClientRect();
      const activeCenterX = activeRect.left + activeRect.width / 2;
      const activeCenterY = activeRect.top + activeRect.height / 2;

      const paneEls = Array.from(document.querySelectorAll(".terminal-pane-wrapper:not(.active)"));
      let bestPaneId: string | null = null;
      let minDistance = Infinity;

      for (const el of paneEls) {
        const rect = el.getBoundingClientRect();
        const paneCenterX = rect.left + rect.width / 2;
        const paneCenterY = rect.top + rect.height / 2;

        let matchesDirection = false;
        if (dir === "left" && paneCenterX < activeCenterX - 10) {
          matchesDirection = true;
        } else if (dir === "right" && paneCenterX > activeCenterX + 10) {
          matchesDirection = true;
        } else if (dir === "up" && paneCenterY < activeCenterY - 10) {
          matchesDirection = true;
        } else if (dir === "down" && paneCenterY > activeCenterY + 10) {
          matchesDirection = true;
        }

        if (matchesDirection) {
          const dx = paneCenterX - activeCenterX;
          const dy = paneCenterY - activeCenterY;
          const dist = dx * dx + dy * dy;
          if (dist < minDistance) {
            minDistance = dist;
            bestPaneId = el.getAttribute("data-pane-id");
          }
        }
      }

      if (bestPaneId && activeTab) {
        updateTab({
          id: activeTab.id,
          patch: { activePaneId: bestPaneId }
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [cycleTab, cyclePane, activeTab, updateTab]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        unlisten = await listen<AppConfig>("remux:config-changed", (evt) => {
          applyExternalConfig(evt.payload);
        });
      } catch (e) {
        console.warn("config change listener failed", e);
      }
    })();
    return () => {
      unlisten?.();
    };
  }, [applyExternalConfig]);

  useEffect(() => {
    void (async () => {
      try {
        const v = await tmuxLocalVersion();
        if (v)
          setTmuxVersionLabel(
            `${v.major}.${v.minor}${v.modern_mouse ? "" : " legacy"}`,
          );
        else setTmuxVersionLabel("missing");
      } catch (e) {
        console.warn("tmux version probe failed", e);
      }
    })();
  }, [setTmuxVersionLabel]);

  // Recursively update a specific pane's ptyId within the layout tree
  const updateLayoutPty = (node: PaneLayout, targetPaneId: string, ptyId: string | null): PaneLayout => {
    if (node.type === "leaf") {
      if (node.id === targetPaneId) {
        return { ...node, ptyId };
      }
      return node;
    } else {
      return {
        ...node,
        children: node.children.map((child) => updateLayoutPty(child, targetPaneId, ptyId)),
      };
    }
  };

  const updateLayoutTmuxIdentity = (
    node: PaneLayout,
    targetPaneId: string,
    tmuxIdentity: TmuxPaneIdentity | null,
  ): PaneLayout => {
    if (node.type === "leaf") {
      if (node.id === targetPaneId) {
        return { ...node, tmuxIdentity };
      }
      return node;
    }
    return {
      ...node,
      children: node.children.map((child) => updateLayoutTmuxIdentity(child, targetPaneId, tmuxIdentity)),
    };
  };

  const resolveTmuxIdentity = async (): Promise<TmuxPaneIdentity | null> => {
    if (!activeProfile || !activeHost) return null;
    try {
      const panes =
        activeHost.auth_method === "local"
          ? await tmuxListLocalPanes({
              binary: activeHost.custom_tmux_binary,
              socketPath: activeHost.tmux_socket_path,
            })
          : activeHost.auth_method === "password"
            ? []
            : await tmuxListRemotePanes({
                ...remoteSshArgs(activeHost),
                tmuxBinary: activeHost.custom_tmux_binary,
                socketPath: activeHost.tmux_socket_path,
              });
      const matching = panes.filter((pane) => {
        if (pane.sessionName !== activeProfile.tmux_session_name) return false;
        if (activeProfile.tmux_window_target && pane.windowName !== activeProfile.tmux_window_target) return false;
        return true;
      });
      return matching.length === 1 ? matching[0] : null;
    } catch (e) {
      console.warn("tmux pane identity refresh failed", e);
      return null;
    }
  };

  const launchSession = async (
    tabId: string,
    paneId: string,
    mode: "tmux" | "raw" | "install-local" | "ssh-raw" = "tmux",
  ): Promise<boolean> => {
    if (!activeProfile || !activeHost) return false;

    // 1. Pre-probe for tmux if connection is requested in tmux mode
    if (mode === "tmux") {
      if (activeHost.auth_method === "local") {
        const v = await tmuxLocalVersion();
        if (!v) {
          setMissingTmuxReq({ tabId, isLocal: true });
          return false;
        }
      } else {
        try {
          updateTab({
            id: tabId,
            patch: { state: "connecting", bannerMessage: "Probing remote host..." },
          });
          const probe = await probeRemoteEnv({
            ...remoteSshArgs(activeHost),
          });
          setLocaleWarning(formatRemoteLocaleWarning(probe));
          if (probe && !probe.tmuxPresent) {
            updateTab({
              id: tabId,
              patch: { missingTmuxRemote: true },
            });
            void launchSession(tabId, paneId, "ssh-raw");
            return false;
          }
        } catch (e) {
          console.warn("Remote env probe failed, proceeding to direct connection", e);
        }
      }
    }

    const isLocalConnection = activeHost.auth_method === "local" || mode === "raw" || mode === "install-local";
    if (!isLocalConnection) {
      updateTab({
        id: tabId,
        patch: { state: "connecting", bannerMessage: undefined },
      });
    }

    let activeSessionId: string | null = null;
    const channel = new Channel<PtyEvent>();
    channel.onmessage = (evt) => {
      if (evt.kind === "data") {
        const handle = termHandlesRef.current.get(paneId);
        handle?.write(evt.data);
        if (viewModeRef.current === "follow") {
          const tab = tabsRef.current.find((t) => t.id === tabId);
          if (tab?.activePaneId !== paneId) {
            updateTab({
              id: tabId,
              patch: { activePaneId: paneId },
            });
          }
        }
      } else if (evt.kind === "fingerprint") {
        setFingerprintReq({
          host: activeHost.address,
          fingerprintBlock: evt.challenge,
          resolve: (accept) => {
            if (accept) {
              if (activeSessionId) {
                void ptyWrite(activeSessionId, "yes\n");
              }
            } else {
              if (activeSessionId) {
                void ptyKill(activeSessionId);
              }
              const tab = tabs.find((t) => t.id === tabId);
              if (tab && tab.layout) {
                const nextLayout = updateLayoutPty(tab.layout, paneId, null);
                updateTab({
                  id: tabId,
                  patch: {
                    layout: nextLayout,
                    state: "closed",
                    bannerMessage: "SSH connection rejected by user.",
                  },
                });
              }
            }
            setFingerprintReq(null);
          },
        });
      } else if (evt.kind === "exit") {
        const binding = bindingsRef.current.get(paneId);
        bindingsRef.current.delete(paneId);

        // Remove the ptyId from the layout node
        const tab = tabs.find((t) => t.id === tabId);
        if (tab && tab.layout) {
          const nextLayout = updateLayoutPty(tab.layout, paneId, null);
          updateTab({
            id: tabId,
            patch: {
              layout: nextLayout,
              state: binding?.kind === "tmux" ? "warning" : "closed",
              bannerMessage: binding?.kind === "tmux" ? `tmux session ended (code ${evt.code ?? "?"}).` : undefined,
            },
          });
        }

        if (binding?.kind === "tmux") {
          if (evt.code !== 0 && activeHost && activeHost.auth_method !== "local") {
            if (evt.code === 255) {
              updateTab({
                id: tabId,
                patch: {
                  state: "error",
                  bannerMessage: `SSH connection failed (code 255). Please check your SSH credentials, ssh-agent status, or key permissions.`,
                },
              });
              return;
            }

            setDisconnectedPanes((prev) => {
              const next = new Map(prev);
              next.set(paneId, {
                countdown: 5,
                retryCount: 0,
                bannerMessage: `Remote tmux session disconnected abnormally (code ${evt.code ?? "unknown"}). Retrying to recover...`,
              });
              return next;
            });
          } else {
            setFallbackReq({
              tabId,
              sessionName: activeProfile.tmux_session_name,
              exitCode: evt.code,
            });
          }
        }
      }
    };

    const handle = termHandlesRef.current.get(paneId);
    const cols = handle?.cols() ?? 80;
    const rows = handle?.rows() ?? 24;

    try {
      let sid: string;
      if (mode === "raw" || mode === "install-local") {
        sid = await ptySpawnLocal({
          shell: undefined,
          cwd: undefined,
          cols,
          rows,
          channel,
        });
      } else if (mode === "ssh-raw") {
        const savedPw =
          activeHost.auth_method === "password"
            ? (await secretsGet(hostAccount(activeHost.id))) || undefined
            : undefined;
        sid = await ptySpawnSshTmux({
          ...remoteSshArgs(activeHost),
          tmuxSession: undefined,
          tmuxWindow: undefined,
          password: savedPw,
          cols,
          rows,
          channel,
        });
      } else if (activeHost.auth_method === "local") {
        sid = await ptySpawnTmuxLocal({
          session: activeProfile.tmux_session_name,
          detachOthers: activeHost.detach_other_clients,
          window: activeProfile.tmux_window_target,
          socketPath: activeHost.tmux_socket_path,
          tmuxBinary: activeHost.custom_tmux_binary,
          cols,
          rows,
          channel,
        });
      } else {
        const savedPw =
          activeHost.auth_method === "password"
            ? (await secretsGet(hostAccount(activeHost.id))) || undefined
            : undefined;
        sid = await ptySpawnSshTmux({
          ...remoteSshArgs(activeHost),
          tmuxSession: activeProfile.tmux_session_name,
          tmuxWindow: activeProfile.tmux_window_target,
          password: savedPw,
          cols,
          rows,
          channel,
        });
      }
      
      activeSessionId = sid;
      bindingsRef.current.set(paneId, {
        tabId,
        paneId,
        sessionId: sid,
        kind: (mode === "raw" || mode === "install-local" || mode === "ssh-raw") ? "raw" : "tmux",
      });

      const currentTab = tabs.find((t) => t.id === tabId);
      if (currentTab && currentTab.layout) {
        let nextLayout = updateLayoutPty(currentTab.layout, paneId, sid);
        if (mode === "tmux") {
          nextLayout = updateLayoutTmuxIdentity(nextLayout, paneId, await resolveTmuxIdentity());
        }
        updateTab({
          id: tabId,
          patch: { layout: nextLayout, state: "connected" },
        });
      }

      setViewMode("normal");

      if (mode === "install-local") {
        setTimeout(() => {
          void ptyWrite(sid, "brew install tmux\n");
        }, 500);
      }

      return true;
    } catch (err) {
      console.error("session launch failed", err);
      updateTab({
        id: tabId,
        patch: { state: "error", bannerMessage: String(err) },
      });
      return false;
    }
  };

  const triggerReattach = async (paneId: string, currentRetryCount: number) => {
    let targetTabId: string | null = null;
    for (const t of tabs) {
      const hasPane = (node: PaneLayout): boolean => {
        if (node.type === "leaf") return node.id === paneId;
        return node.children.some(hasPane);
      };
      if (t.layout && hasPane(t.layout)) {
        targetTabId = t.id;
        break;
      }
    }

    if (!targetTabId) {
      setDisconnectedPanes((prev) => {
        const next = new Map(prev);
        next.delete(paneId);
        return next;
      });
      return;
    }

    const success = await launchSession(targetTabId, paneId, "tmux");
    if (success) {
      setDisconnectedPanes((prev) => {
        const next = new Map(prev);
        next.delete(paneId);
        return next;
      });
    } else {
      const nextRetryCount = currentRetryCount + 1;
      if (nextRetryCount > 3) {
        setDisconnectedPanes((prev) => {
          const next = new Map(prev);
          next.delete(paneId);
          return next;
        });
        updateTab({
          id: targetTabId,
          patch: {
            state: "error",
            bannerMessage: "Failed to recover tmux session after 3 attempts. Please check host connection manually.",
          },
        });
        return;
      }
      const nextCountdown = Math.min(5 * Math.pow(2, nextRetryCount), 60);
      setDisconnectedPanes((prev) => {
        const next = new Map(prev);
        const existing = next.get(paneId);
        if (existing) {
          next.set(paneId, {
            ...existing,
            countdown: nextCountdown,
            retryCount: nextRetryCount,
            bannerMessage: `Reattach attempt ${nextRetryCount} failed. Retrying in ${nextCountdown}s...`,
          });
        }
        return next;
      });
    }
  };

  useEffect(() => {
    if (disconnectedPanes.size === 0) return;

    const interval = setInterval(() => {
      setDisconnectedPanes((prev) => {
        let changed = false;
        const next = new Map(prev);

        for (const [paneId, state] of next.entries()) {
          if (state.countdown > 1) {
            next.set(paneId, {
              ...state,
              countdown: state.countdown - 1,
            });
            changed = true;
          } else if (state.countdown === 1) {
            next.set(paneId, {
              ...state,
              countdown: 0,
            });
            changed = true;
            void triggerReattach(paneId, state.retryCount);
          }
        }

        return changed ? next : prev;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [disconnectedPanes, tabs]);

  const handleRetryPane = (paneId: string) => {
    setDisconnectedPanes((prev) => {
      const next = new Map(prev);
      const existing = next.get(paneId);
      if (existing) {
        next.set(paneId, {
          ...existing,
          countdown: 0,
        });
      }
      return next;
    });
    void triggerReattach(paneId, 0);
  };

  const refreshActiveTmuxState = async (): Promise<void> => {
    if (!activeTab || activeTab.state !== "connected" || !activeHost || !activeProfile) return;

    try {
      const hierarchy = await tmuxProbeHierarchy({
        host: activeHost.auth_method === "local" ? undefined : activeHost.address,
        user: activeHost.username || undefined,
        port: activeHost.port || undefined,
        sshConfigAlias: activeHost.ssh_config_alias,
        keyPath: activeHost.key_path,
        proxyJump: activeHost.proxy_jump,
        identityAgent: activeHost.identity_agent,
        tmuxBinary: activeHost.custom_tmux_binary || undefined,
        socketPath: activeHost.tmux_socket_path || undefined,
      });
      setHierarchyRecord((prev) => ({
        ...prev,
        [activeTab.id]: hierarchy,
      }));
    } catch (err) {
      console.warn("Immediate tmux hierarchy refresh failed", err);
    }

    try {
      const allPanes =
        activeHost.auth_method === "local"
          ? await tmuxListLocalPanes({
              binary: activeHost.custom_tmux_binary || undefined,
              socketPath: activeHost.tmux_socket_path || undefined,
            })
          : await tmuxListRemotePanes({
              ...remoteSshArgs(activeHost),
              tmuxBinary: activeHost.custom_tmux_binary || undefined,
              socketPath: activeHost.tmux_socket_path || undefined,
            });

      let sessionPanes = allPanes.filter((pane) => pane.sessionName === activeProfile.tmux_session_name);
      if (activeProfile.tmux_window_target) {
        const target = activeProfile.tmux_window_target;
        sessionPanes = sessionPanes.filter((pane) => {
          if (/^\d+$/.test(target)) return pane.windowIndex === parseInt(target, 10);
          return pane.windowName === target;
        });
      }
      sessionPanes.sort((a, b) => a.paneIndex - b.paneIndex);
      refreshPaneIdentities({ tabId: activeTab.id, sessionPanes });
    } catch (err) {
      console.warn("Immediate tmux pane identity refresh failed", err);
    }
  };

  const executeTmuxCommand = async (
    command: TmuxCommand,
    paneId: string,
    direction?: TmuxSplitDirection
  ): Promise<boolean> => {
    if (!activeHost || !activeProfile) return false;

    const tab = tabs.find((t) => t.id === activeTab?.id);
    if (!tab || !tab.layout) return false;

    const leafNode = findLeafNode(tab.layout, paneId);
    if (!leafNode || !leafNode.tmuxIdentity) return false;

    const nativeId = leafNode.tmuxIdentity.paneId;
    const isLocal = activeHost.auth_method === "local";
    const shouldUseNativeRemote = supportsNativeTmuxCommands(activeHost);

    if (!shouldUseNativeRemote) {
      updateTab({
        id: activeTab?.id ?? tab.id,
        patch: {
          bannerMessage:
            nativeTmuxDisabledReasonForActiveHost("Native remote tmux commands") ||
            "Native remote tmux commands are unavailable for this host.",
        },
      });
      return false;
    }

    try {
      if (isLocal) {
        const localArgs = {
          target: nativeId,
          binary: activeHost.custom_tmux_binary || undefined,
          socketPath: activeHost.tmux_socket_path || undefined,
        };

        if (command === "select") {
          await tmuxSelectLocalPane(localArgs);
        } else if (command === "zoom") {
          await tmuxZoomLocalPane(localArgs);
        } else if (command === "kill") {
          await tmuxKillLocalPane(localArgs);
        } else if (command === "split") {
          if (!direction) return false;
          await tmuxSplitLocalPane({
            ...localArgs,
            direction,
          });
        }
      } else {
        const remoteArgs = {
          ...remoteSshArgs(activeHost),
          target: nativeId,
          tmuxBinary: activeHost.custom_tmux_binary || undefined,
          socketPath: activeHost.tmux_socket_path || undefined,
        };

        if (command === "select") {
          await tmuxSelectRemotePane(remoteArgs);
        } else if (command === "zoom") {
          await tmuxZoomRemotePane(remoteArgs);
        } else if (command === "kill") {
          await tmuxKillRemotePane(remoteArgs);
        } else if (command === "split") {
          if (!direction) return false;
          await tmuxSplitRemotePane({
            ...remoteArgs,
            direction,
          });
        }
      }
      window.setTimeout(() => {
        void refreshActiveTmuxState();
      }, 250);
      return true;
    } catch (err) {
      console.warn(`Failed to execute tmux command ${command} on target ${nativeId}:`, err);
      return false;
    }
  };

  const handleSplitPane = async (paneId: string, direction: "row" | "column") => {
    if (!activeTab) return;

    const binding = bindingsRef.current.get(paneId);
    const isTmux = binding?.kind === "tmux";

    if (isTmux) {
      const didNativeSplit = await executeTmuxCommand("split", paneId, direction);
      if (didNativeSplit) return;
    }

    const newPaneId = splitPane({
      tabId: activeTab.id,
      paneId,
      direction,
    });

    if (newPaneId) {
      void launchSession(activeTab.id, newPaneId, isTmux ? "tmux" : "raw");
    }
  };

  const handleClosePane = async (paneId: string) => {
    let targetTabId: string | null = null;
    for (const t of tabs) {
      const hasPane = (node: PaneLayout): boolean => {
        if (node.type === "leaf") return node.id === paneId;
        return node.children.some(hasPane);
      };
      if (t.layout && hasPane(t.layout)) {
        targetTabId = t.id;
        break;
      }
    }

    if (!targetTabId) return;

    const binding = bindingsRef.current.get(paneId);
    const isTmux = binding?.kind === "tmux";

    if (isTmux) {
      const didNativeKill = await executeTmuxCommand("kill", paneId);
      if (didNativeKill) return;
    }

    setDisconnectedPanes((prev) => {
      const next = new Map(prev);
      next.delete(paneId);
      return next;
    });

    closePane({ tabId: targetTabId, paneId });
  };

  const handleRenameWindow = async (paneId: string) => {
    if (!activeTab || !activeHost || !activeProfile || !activeTab.layout) return;

    const leafNode = findLeafNode(activeTab.layout, paneId);
    const identity = leafNode?.tmuxIdentity;
    if (!identity) {
      updateTab({
        id: activeTab.id,
        patch: { bannerMessage: "Rename requires a known native tmux pane identity." },
      });
      return;
    }

    const currentName = identity.windowName || activeProfile.tmux_window_target || "";
    setRenameWindowReq({
      kind: "window",
      paneId,
      currentName,
      identityLabel: `${identity.sessionName}:${identity.windowIndex}.${identity.paneIndex}`,
    });
  };

  const handleRenamePane = async (paneId: string) => {
    if (!activeTab || !activeHost || !activeTab.layout) return;

    const leafNode = findLeafNode(activeTab.layout, paneId);
    const identity = leafNode?.tmuxIdentity;
    if (!identity) {
      updateTab({
        id: activeTab.id,
        patch: { bannerMessage: "Pane title requires a known native tmux pane identity." },
      });
      return;
    }

    setRenameWindowReq({
      kind: "pane",
      paneId,
      currentName: identity.paneTitle || "",
      identityLabel: `${identity.sessionName}:${identity.windowIndex}.${identity.paneIndex}`,
    });
  };

  const handleApplyLayoutPreset = async (paneId: string, preset: TmuxLayoutPreset) => {
    if (!activeTab || !activeHost || !activeProfile || !activeTab.layout) return;

    const leafNode = findLeafNode(activeTab.layout, paneId);
    const identity = leafNode?.tmuxIdentity;

    if (!identity) {
      applyPreset({ tabId: activeTab.id, preset });
      return;
    }

    try {
      const target = identity.windowId || `${identity.sessionName}:${identity.windowIndex}`;
      if (activeHost.auth_method === "local") {
        await tmuxSelectLocalLayout({
          target,
          preset,
          binary: activeHost.custom_tmux_binary || undefined,
          socketPath: activeHost.tmux_socket_path || undefined,
        });
      } else if (!supportsNativeTmuxCommands(activeHost)) {
        updateTab({
          id: activeTab.id,
          patch: {
            bannerMessage:
              nativeTmuxDisabledReasonForActiveHost("Remote layout preset") ||
              "Remote layout presets are unavailable for this host.",
          },
        });
        return;
      } else {
        await tmuxSelectRemoteLayout({
          ...remoteSshArgs(activeHost),
          target,
          preset,
          tmuxBinary: activeHost.custom_tmux_binary || undefined,
          socketPath: activeHost.tmux_socket_path || undefined,
        });
      }

      updateTab({ id: activeTab.id, patch: { bannerMessage: undefined } });
      window.setTimeout(() => {
        void refreshActiveTmuxState();
      }, 250);
    } catch (err) {
      console.warn("Failed to apply tmux layout preset", err);
      updateTab({
        id: activeTab.id,
        patch: { bannerMessage: `Layout preset failed: ${String(err)}` },
      });
    }
  };

  const submitRenameWindow = async (paneId: string, nextName: string) => {
    if (!activeTab || !activeHost || !activeTab.layout) return;

    const leafNode = findLeafNode(activeTab.layout, paneId);
    const identity = leafNode?.tmuxIdentity;
    if (!identity) {
      setRenameWindowReq(null);
      updateTab({
        id: activeTab.id,
        patch: { bannerMessage: "Rename requires a known native tmux pane identity." },
      });
      return;
    }

    try {
      const target = identity.windowId || `${identity.sessionName}:${identity.windowIndex}`;
      if (activeHost.auth_method === "local") {
        await tmuxRenameLocalWindow({
          target,
          name: nextName,
          binary: activeHost.custom_tmux_binary || undefined,
          socketPath: activeHost.tmux_socket_path || undefined,
        });
      } else if (!supportsNativeTmuxCommands(activeHost)) {
        setRenameWindowReq(null);
        updateTab({
          id: activeTab.id,
          patch: {
            bannerMessage:
              nativeTmuxDisabledReasonForActiveHost("Remote window rename") ||
              "Remote window rename is unavailable for this host.",
          },
        });
        return;
      } else {
        await tmuxRenameRemoteWindow({
          ...remoteSshArgs(activeHost),
          target,
          name: nextName,
          tmuxBinary: activeHost.custom_tmux_binary || undefined,
          socketPath: activeHost.tmux_socket_path || undefined,
        });
      }

      setRenameWindowReq(null);
      updateTab({ id: activeTab.id, patch: { bannerMessage: undefined } });
      window.setTimeout(() => {
        void refreshActiveTmuxState();
      }, 250);
    } catch (err) {
      console.warn("Failed to rename tmux window", err);
      updateTab({
        id: activeTab.id,
        patch: { bannerMessage: `Rename failed: ${String(err)}` },
      });
    }
  };

  const submitRenamePane = async (paneId: string, nextTitle: string) => {
    if (!activeTab || !activeHost || !activeTab.layout) return;

    const leafNode = findLeafNode(activeTab.layout, paneId);
    const identity = leafNode?.tmuxIdentity;
    if (!identity) {
      setRenameWindowReq(null);
      updateTab({
        id: activeTab.id,
        patch: { bannerMessage: "Pane title requires a known native tmux pane identity." },
      });
      return;
    }

    try {
      const target = identity.paneId;
      if (activeHost.auth_method === "local") {
        await tmuxRenameLocalPane({
          target,
          title: nextTitle,
          binary: activeHost.custom_tmux_binary || undefined,
          socketPath: activeHost.tmux_socket_path || undefined,
        });
      } else if (!supportsNativeTmuxCommands(activeHost)) {
        setRenameWindowReq(null);
        updateTab({
          id: activeTab.id,
          patch: {
            bannerMessage:
              nativeTmuxDisabledReasonForActiveHost("Remote pane title rename") ||
              "Remote pane title rename is unavailable for this host.",
          },
        });
        return;
      } else {
        await tmuxRenameRemotePane({
          ...remoteSshArgs(activeHost),
          target,
          title: nextTitle,
          tmuxBinary: activeHost.custom_tmux_binary || undefined,
          socketPath: activeHost.tmux_socket_path || undefined,
        });
      }

      setRenameWindowReq(null);
      updateTab({ id: activeTab.id, patch: { bannerMessage: undefined } });
      window.setTimeout(() => {
        void refreshActiveTmuxState();
      }, 250);
    } catch (err) {
      console.warn("Failed to rename tmux pane", err);
      updateTab({
        id: activeTab.id,
        patch: { bannerMessage: `Pane title rename failed: ${String(err)}` },
      });
    }
  };

  const submitRenameWindowDirect = async (target: string, nextName: string) => {
    if (!activeTab || !activeHost) return;
    try {
      if (activeHost.auth_method === "local") {
        await tmuxRenameLocalWindow({
          target,
          name: nextName,
          binary: activeHost.custom_tmux_binary || undefined,
          socketPath: activeHost.tmux_socket_path || undefined,
        });
      } else if (!supportsNativeTmuxCommands(activeHost)) {
        updateTab({
          id: activeTab.id,
          patch: {
            bannerMessage:
              nativeTmuxDisabledReasonForActiveHost("Remote window rename") ||
              "Remote window rename is unavailable for this host.",
          },
        });
        return;
      } else {
        await tmuxRenameRemoteWindow({
          ...remoteSshArgs(activeHost),
          target,
          name: nextName,
          tmuxBinary: activeHost.custom_tmux_binary || undefined,
          socketPath: activeHost.tmux_socket_path || undefined,
        });
      }

      setRenameWindowReq(null);
      updateTab({ id: activeTab.id, patch: { bannerMessage: undefined } });
      window.setTimeout(() => {
        void refreshActiveTmuxState();
      }, 250);
    } catch (err) {
      console.warn("Failed to rename tmux window", err);
      updateTab({
        id: activeTab.id,
        patch: { bannerMessage: `Rename failed: ${String(err)}` },
      });
    }
  };

  const handleRenameWindowDirect = (sessionName: string, windowId: string, currentName: string) => {
    setRenameWindowReq({
      kind: "window-direct",
      target: windowId,
      currentName,
      identityLabel: `${sessionName}:${windowId}`,
    });
  };

  const handleNewWindow = async (sessionName: string) => {
    if (!activeTab || !activeHost) return;
    try {
      if (activeHost.auth_method === "local") {
        await tmuxNewLocalWindow({
          target: sessionName,
          binary: activeHost.custom_tmux_binary || undefined,
          socketPath: activeHost.tmux_socket_path || undefined,
        });
      } else if (!supportsNativeTmuxCommands(activeHost)) {
        updateTab({
          id: activeTab.id,
          patch: {
            bannerMessage:
              nativeTmuxDisabledReasonForActiveHost("Remote window spawn") ||
              "Remote window spawn is unavailable for this host.",
          },
        });
        return;
      } else {
        await tmuxNewRemoteWindow({
          ...remoteSshArgs(activeHost),
          target: sessionName,
          tmuxBinary: activeHost.custom_tmux_binary || undefined,
          socketPath: activeHost.tmux_socket_path || undefined,
        });
      }
      window.setTimeout(() => {
        void refreshActiveTmuxState();
      }, 250);
    } catch (err) {
      console.warn("Failed to spawn new tmux window", err);
      updateTab({
        id: activeTab.id,
        patch: { bannerMessage: `Failed to spawn new window: ${String(err)}` },
      });
    }
  };

  const handleKillWindow = async (_sessionName: string, windowId: string, windowName: string) => {
    if (!activeTab || !activeHost) return;
    const ok = window.confirm(`Are you sure you want to kill window "${windowName}" (${windowId})?`);
    if (!ok) return;

    try {
      if (activeHost.auth_method === "local") {
        await tmuxKillLocalWindow({
          target: windowId,
          binary: activeHost.custom_tmux_binary || undefined,
          socketPath: activeHost.tmux_socket_path || undefined,
        });
      } else if (!supportsNativeTmuxCommands(activeHost)) {
        updateTab({
          id: activeTab.id,
          patch: {
            bannerMessage:
              nativeTmuxDisabledReasonForActiveHost("Remote window kill") ||
              "Remote window kill is unavailable for this host.",
          },
        });
        return;
      } else {
        await tmuxKillRemoteWindow({
          ...remoteSshArgs(activeHost),
          target: windowId,
          tmuxBinary: activeHost.custom_tmux_binary || undefined,
          socketPath: activeHost.tmux_socket_path || undefined,
        });
      }
      window.setTimeout(() => {
        void refreshActiveTmuxState();
      }, 250);
    } catch (err) {
      console.warn("Failed to kill tmux window", err);
      updateTab({
        id: activeTab.id,
        patch: { bannerMessage: `Failed to kill window: ${String(err)}` },
      });
    }
  };

  // Helper to gather all unconnected (ptyId === null) leaf IDs in a tree
  const collectUnconnectedLeafIds = (node: PaneLayout): string[] => {
    if (node.type === "leaf") {
      return node.ptyId ? [] : [node.id];
    } else {
      return node.children.flatMap(collectUnconnectedLeafIds);
    }
  };

  // Helper to find a leaf pane in layout
  const findLeafNode = (node: PaneLayout, targetId: string): Extract<PaneLayout, { type: "leaf" }> | null => {
    if (node.type === "leaf") {
      return node.id === targetId ? node : null;
    }
    for (const child of node.children) {
      const found = findLeafNode(child, targetId);
      if (found) return found;
    }
    return null;
  };

  // 3. Native Window Title auto-sync
  useEffect(() => {
    const updateTitle = async () => {
      try {
        const win = getCurrentWindow();
        if (!win) return;
        
        let title = "REMUX";
        if (activeTab) {
          const leafNode = activeTab.layout ? findLeafNode(activeTab.layout, activeTab.activePaneId ?? "") : null;
          const panePid = leafNode?.tmuxIdentity?.panePid;
          const cmdName = leafNode?.tmuxIdentity?.paneCurrentCommand;
          
          const hostLabel = activeHost ? activeHost.label : "";
          const sessionName = activeProfile ? activeProfile.tmux_session_name : "";
          
          if (hostLabel && sessionName) {
            title = `REMUX - ${hostLabel} / ${sessionName}`;
            if (panePid) {
              title += ` (PID ${panePid}${cmdName ? `: ${cmdName}` : ""})`;
            }
          } else if (activeProfile) {
            title = `REMUX - ${activeProfile.display_alias}`;
          }
        }
        await win.setTitle(title);
      } catch (e) {
        console.warn("Failed to set window title", e);
      }
    };
    void updateTitle();
  }, [activeTab?.id, activeTab?.activePaneId, activeHost, activeProfile]);

  // 1. Polling tmux Live Inventory hierarchy
  useEffect(() => {
    if (!activeTab || activeTab.state !== "connected" || !activeHost || hierarchyInterval === 0) return;

    const pollHierarchy = async () => {
      try {
        const tree = await tmuxProbeHierarchy({
          host: activeHost.auth_method === "local" ? undefined : activeHost.address,
          user: activeHost.username || undefined,
          port: activeHost.port || undefined,
          sshConfigAlias: activeHost.ssh_config_alias,
          keyPath: activeHost.key_path,
          proxyJump: activeHost.proxy_jump,
          identityAgent: activeHost.identity_agent,
          tmuxBinary: activeHost.custom_tmux_binary,
          socketPath: activeHost.tmux_socket_path,
        });
        setHierarchyRecord((prev) => ({
          ...prev,
          [activeTab.id]: tree,
        }));
      } catch (e) {
        console.warn("Background hierarchy probe failed", e);
      }
    };

    // Run once immediately on connect
    void pollHierarchy();

    const timer = setInterval(() => {
      void pollHierarchy();
    }, hierarchyInterval);

    return () => clearInterval(timer);
  }, [activeTab?.id, activeTab?.state, activeHost, setHierarchyRecord, hierarchyInterval]);

  // 2. Telemetry polling: Process memory RSS size, child process PID details, and heartbeat RTT
  useEffect(() => {
    if (
      !activeTab ||
      activeTab.state !== "connected" ||
      !activeHost ||
      !activeTab.layout ||
      !activeTab.activePaneId ||
      telemetryInterval === 0
    )
      return;

    const pollDiagnostics = async () => {
      const leafNode = findLeafNode(activeTab.layout!, activeTab.activePaneId!);
      if (!leafNode) return;

      const panePid = leafNode.tmuxIdentity?.panePid;
      if (!panePid) {
        // If there's no PID yet, set default local latency or maintain current state
        setDiagnostics((prev) => {
          const existing = prev[activeTab.activePaneId!] || {};
          return {
            ...prev,
            [activeTab.activePaneId!]: {
              ...existing,
              heartbeatStatus: activeHost.auth_method === "local" ? "stable" : existing.heartbeatStatus || "stable",
            },
          };
        });
        return;
      }

      const startTime = performance.now();
      try {
        const kb = await getProcessMemory({
          pid: panePid,
          host: activeHost.auth_method === "local" ? undefined : activeHost.address,
          user: activeHost.username || undefined,
          port: activeHost.port || undefined,
          sshConfigAlias: activeHost.ssh_config_alias,
          keyPath: activeHost.key_path,
          proxyJump: activeHost.proxy_jump,
          identityAgent: activeHost.identity_agent,
        });
        const endTime = performance.now();
        const rtt = Math.round(endTime - startTime);

        // Update OpenTab rttMs directly in openTabsAtom
        updateTab({
          id: activeTab.id,
          patch: { rttMs: rtt },
        });

        // Determine heartbeat stability based on RTT threshold
        const status = rtt < 150 ? "stable" : rtt < 600 ? "lagging" : "offline";

        setDiagnostics((prev) => ({
          ...prev,
          [activeTab.activePaneId!]: {
            memoryKb: kb,
            heartbeatStatus: status,
          },
        }));
      } catch (e) {
        console.warn("Background telemetry probe failed", e);
        setDiagnostics((prev) => ({
          ...prev,
          [activeTab.activePaneId!]: {
            ...(prev[activeTab.activePaneId!] || {}),
            heartbeatStatus: "offline",
          },
        }));
        updateTab({
          id: activeTab.id,
          patch: { rttMs: undefined },
        });
      }
    };

    // Run once immediately on connect
    void pollDiagnostics();

    const timer = setInterval(() => {
      void pollDiagnostics();
    }, telemetryInterval);

    return () => clearInterval(timer);
  }, [
    activeTab?.id,
    activeTab?.activePaneId,
    activeTab?.state,
    activeHost,
    updateTab,
    setDiagnostics,
    telemetryInterval,
  ]);

  // 2.1 Polling tmux pane identities for real-time StatusLine and Pane Headers
  useEffect(() => {
    if (
      !activeTab ||
      activeTab.state !== "connected" ||
      !activeHost ||
      !activeProfile ||
      telemetryInterval === 0
    ) {
      return;
    }

    const pollPaneIdentities = async () => {
      try {
        let allPanes: TmuxPaneIdentity[] = [];
        if (activeHost.auth_method === "local") {
          allPanes = await tmuxListLocalPanes({
            binary: activeHost.custom_tmux_binary || undefined,
            socketPath: activeHost.tmux_socket_path || undefined,
          });
        } else {
          allPanes = await tmuxListRemotePanes({
            ...remoteSshArgs(activeHost),
            tmuxBinary: activeHost.custom_tmux_binary || undefined,
            socketPath: activeHost.tmux_socket_path || undefined,
          });
        }

        let sessionPanes = allPanes.filter(
          (p) => p.sessionName === activeProfile.tmux_session_name
        );

        if (activeProfile.tmux_window_target) {
          const target = activeProfile.tmux_window_target;
          sessionPanes = sessionPanes.filter((p) => {
            if (/^\d+$/.test(target)) {
              return p.windowIndex === parseInt(target, 10);
            }
            return p.windowName === target;
          });
        }

        sessionPanes.sort((a, b) => a.paneIndex - b.paneIndex);

        refreshPaneIdentities({ tabId: activeTab.id, sessionPanes });
      } catch (err) {
        console.warn("Failed to poll tmux pane identities:", err);
      }
    };

    void pollPaneIdentities();

    const timer = setInterval(() => {
      void pollPaneIdentities();
    }, telemetryInterval);

    return () => clearInterval(timer);
  }, [
    activeTab?.id,
    activeTab?.state,
    activeHost,
    activeProfile,
    telemetryInterval,
    refreshPaneIdentities,
  ]);

  // 2.2 Focus synchronization: sync REMUX active pane to native tmux pane
  useEffect(() => {
    if (
      !activeTab ||
      !activeTab.activePaneId ||
      activeTab.state !== "connected" ||
      !activeHost ||
      !activeProfile
    ) {
      return;
    }

    const binding = bindingsRef.current.get(activeTab.activePaneId);
    if (binding?.kind === "tmux" && supportsNativeTmuxCommands(activeHost)) {
      void executeTmuxCommand("select", activeTab.activePaneId);
    }
  }, [activeTab?.activePaneId, activeTab?.state, activeHost, activeProfile]);

  useEffect(() => {
    if (!activeTab || activeTab.state !== "connected" || !activeHost || !activeProfile) return;

    const target = activeProfile.tmux_session_name;
    if (!target) return;

    const enabled = mousePolicy === "tmux";
    const syncMousePolicy = async () => {
      try {
        if (activeHost.auth_method === "local") {
          await tmuxSetLocalMouse({
            target,
            enabled,
            binary: activeHost.custom_tmux_binary || undefined,
            socketPath: activeHost.tmux_socket_path || undefined,
          });
        } else if (!supportsNativeTmuxCommands(activeHost)) {
          if (!enabled) return;
          setMousePolicy("remux");
          updateTab({
            id: activeTab.id,
            patch: {
              bannerMessage:
                `${nativeTmuxDisabledReasonForActiveHost("Mouse handoff") || "Mouse handoff is unavailable for this host."} REMUX mouse handling was restored.`,
            },
          });
        } else {
          await tmuxSetRemoteMouse({
            ...remoteSshArgs(activeHost),
            target,
            enabled,
            tmuxBinary: activeHost.custom_tmux_binary || undefined,
            socketPath: activeHost.tmux_socket_path || undefined,
          });
        }
      } catch (err) {
        console.warn("Failed to sync tmux mouse policy", err);
        updateTab({
          id: activeTab.id,
          patch: { bannerMessage: `tmux mouse sync failed: ${String(err)}` },
        });
      }
    };

    void syncMousePolicy();
  }, [activeTab?.id, activeTab?.state, activeHost, activeProfile, mousePolicy, setMousePolicy]);

  const handleAttachToTarget = async (sessionName: string, windowName?: string) => {
    if (!activeTab || !activeProfile) return;
    const updatedProfile = {
      ...activeProfile,
      tmux_session_name: sessionName,
      tmux_window_target: windowName || "",
    };
    await updateProfile(updatedProfile);

    // Cleanly terminate active PTY sessions in layout tree to prevent zombie process leaks
    if (activeTab.layout) {
      const killLeafPtys = (node: PaneLayout) => {
        if (node.type === "leaf") {
          const binding = bindingsRef.current.get(node.id);
          if (binding) {
            void ptyKill(binding.sessionId);
            bindingsRef.current.delete(node.id);
          }
        } else {
          node.children.forEach(killLeafPtys);
        }
      };
      killLeafPtys(activeTab.layout);

      const cleanLayout = (node: PaneLayout): PaneLayout => {
        if (node.type === "leaf") {
          return { type: "leaf", id: node.id, ptyId: null, tmuxIdentity: null };
        } else {
          return {
            type: node.type,
            id: node.id,
            children: node.children.map(cleanLayout),
          };
        }
      };

      updateTab({
        id: activeTab.id,
        patch: {
          state: "idle",
          bannerMessage: undefined,
          layout: cleanLayout(activeTab.layout),
        },
      });
    }
  };

  // Initial trigger for launch
  useEffect(() => {
    if (!activeTab) return;
    if (activeTab.state !== "idle") return;
    if (!activeProfile || !activeHost) return;
    
    if (activeTab.layout) {
      const leafIds = collectUnconnectedLeafIds(activeTab.layout);
      for (const leafId of leafIds) {
        void launchSession(activeTab.id, leafId, "tmux");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHost, activeProfile, activeTab?.id, activeTab?.state]);

  // Kill PTYs on component unmount
  useEffect(() => {
    return () => {
      for (const b of bindingsRef.current.values()) {
        void ptyKill(b.sessionId);
      }
      bindingsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!activeTab) return;
    if (!activeTab.bannerMessage) setLocaleWarning(null);
  }, [activeTab, setLocaleWarning]);

  // Track and kill dead/removed splits or closed tabs
  const closedPaneIds = useMemo(() => {
    const activePaneIds = new Set<string>();
    for (const t of tabs) {
      if (t.layout) {
        const collectIds = (node: PaneLayout) => {
          if (node.type === "leaf") {
            activePaneIds.add(node.id);
          } else {
            node.children.forEach(collectIds);
          }
        };
        collectIds(t.layout);
      }
    }
    return Array.from(bindingsRef.current.keys()).filter((pid) => !activePaneIds.has(pid));
  }, [tabs]);

  useEffect(() => {
    for (const pid of closedPaneIds) {
      const binding = bindingsRef.current.get(pid);
      if (binding) {
        void ptyKill(binding.sessionId);
        bindingsRef.current.delete(pid);
      }
    }
  }, [closedPaneIds]);

  const collectLeafPtyIds = (node: PaneLayout): string[] => {
    if (node.type === "leaf") {
      return node.ptyId ? [node.ptyId] : [];
    } else {
      return node.children.flatMap(collectLeafPtyIds);
    }
  };

  const onTerminalInput = (paneId: string, data: string) => {
    if (!activeTab) return;
    if (viewMode === "readonly") return;
    
    if ((viewMode === "sync" || isBroadcast) && activeTab.layout) {
      const ptyIds = collectLeafPtyIds(activeTab.layout);
      for (const ptyId of ptyIds) {
        void ptyWrite(ptyId, data);
      }
    } else {
      const binding = bindingsRef.current.get(paneId);
      if (binding?.sessionId) {
        void ptyWrite(binding.sessionId, data);
      }
    }
  };

  const onTerminalResize = (paneId: string, cols: number, rows: number) => {
    const binding = bindingsRef.current.get(paneId);
    if (binding?.sessionId) {
      void ptyResize(binding.sessionId, cols, rows);
    }
  };

  const onDoubleClick = async (paneId: string) => {
    const binding = bindingsRef.current.get(paneId);
    if (binding?.kind === "tmux") {
      setViewMode((m) => (m === "focus" ? "normal" : "focus"));
      await executeTmuxCommand("zoom", paneId);
    }
  };

  const hasActiveSession = !!activeTab;

  return (
    <div className="app-shell">
      <TopTabs onRenameWindowDirect={submitRenameWindowDirect} />
      <Sidebar />
      <main className="main" style={{ display: "flex", flexDirection: "row", flex: 1, minWidth: 0 }}>
        <InventorySidebar
          onAttachToTarget={handleAttachToTarget}
          onNewWindow={handleNewWindow}
          onKillWindow={handleKillWindow}
          onRenameWindow={handleRenameWindowDirect}
        />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, height: "100%", position: "relative" }}>
          {activeTab?.bannerMessage && (
            <div
              className={`banner${activeTab.state === "error" ? " danger" : ""}`}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
            >
              <span style={{ flex: 1, paddingRight: "12px" }}>
                {activeTab.bannerMessage}
              </span>
              {activeTab.state === "error" &&
                activeHost &&
                activeHost.auth_method !== "local" &&
                !activeHost.skip_host_key_check &&
                activeTab.bannerMessage.includes("code 255") && (
                  <button
                    className="icon-btn"
                    style={{
                      width: "auto",
                      height: "auto",
                      padding: "6px 12px",
                      fontSize: "11px",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      border: "1px solid var(--accent-dim)",
                      background: "rgba(106, 169, 255, 0.1)",
                      color: "var(--accent)",
                      flexShrink: 0,
                    }}
                    onClick={async () => {
                      const updatedHost = {
                        ...activeHost,
                        skip_host_key_check: true,
                      };
                      await updateHost(updatedHost);
                      
                      const paneId = activeTab.activePaneId;
                      if (paneId) {
                        updateTab({
                          id: activeTab.id,
                          patch: {
                            state: "connecting",
                            bannerMessage: "Retrying connection with trusted host...",
                          },
                        });
                        void launchSession(activeTab.id, paneId, "tmux");
                      }
                    }}
                  >
                    Trust Host &amp; Retry
                  </button>
                )}
            </div>
          )}
          {activeTab?.missingTmuxRemote && (
            <div className="banner" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ flex: 1, paddingRight: "12px" }}>
                ⚠️ <strong>tmux</strong> is not installed on this remote server. Please install it to use REMUX.
              </span>
              <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                <button
                  className="icon-btn"
                  style={{
                    width: "auto",
                    height: "auto",
                    padding: "6px 12px",
                    fontSize: "11px",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    border: "1px solid var(--accent-dim)",
                    background: "rgba(106, 169, 255, 0.1)",
                    color: "var(--accent)"
                  }}
                  onClick={async () => {
                    try {
                      await invoke("plugin:opener|open", { path: "https://github.com/tmux/tmux/wiki/Installing" });
                    } catch (e) {
                      console.error("Failed to open documentation link", e);
                    }
                  }}
                >
                  <ExternalLink size={12} />
                  <span>Installation Guide</span>
                </button>
                <button
                  className="icon-btn"
                  style={{
                    width: "auto",
                    height: "auto",
                    padding: "6px 12px",
                    fontSize: "11px",
                    border: "1px solid var(--border)",
                    background: "transparent"
                  }}
                  onClick={() => {
                    updateTab({ id: activeTab.id, patch: { missingTmuxRemote: false } });
                  }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
          {!hasActiveSession && (
            <div className="empty-state" style={{ flexDirection: "column", gap: 8 }}>
              {hosts.length === 0 ? (
                <>
                  <div style={{ fontSize: 18, color: "var(--fg-0)" }}>Welcome to REMUX</div>
                  <div>
                    Add your first host from the sidebar (<strong>+ Host</strong>) to begin.
                  </div>
                </>
              ) : profiles.length === 0 ? (
                <>
                  <div style={{ fontSize: 16, color: "var(--fg-0)" }}>No connection profiles yet</div>
                  <div>
                    Add a profile (<strong>+ Profile</strong>) — host + tmux screen name.
                  </div>
                </>
              ) : (
                <>Select a connection profile from the sidebar to attach.</>
              )}
            </div>
          )}
          {hasActiveSession && activeTab.layout && (
            <TerminalGrid
              tabId={activeTab.id}
              layout={activeTab.layout}
              activePaneId={activeTab.activePaneId}
              termHandlesRef={termHandlesRef}
              onInput={onTerminalInput}
              onResize={onTerminalResize}
              onDoubleClick={onDoubleClick}
              onPasteRequested={(req) => setPendingPaste(req)}
              onPaneCreated={(paneId) => {
                void launchSession(activeTab.id, paneId, "tmux");
              }}
              localEcho={
                !activeTab.activePaneId || 
                !bindingsRef.current.get(activeTab.activePaneId)?.sessionId
              }
              disconnectedPanes={disconnectedPanes}
              onRetryPane={handleRetryPane}
              onClosePane={handleClosePane}
              onSplitPane={handleSplitPane}
              onApplyLayoutPreset={handleApplyLayoutPreset}
              onRenameWindow={handleRenameWindow}
              onRenamePane={handleRenamePane}
              nativeRenameDisabledReason={
                nativeTmuxDisabledReason(activeHost, "Native tmux rename")
              }
            />
          )}
        </div>
        <AppearancePanel />
      </main>
      <StatusLine />
      {pendingPaste && (
        <PasteGuardModal
          text={pendingPaste.text}
          onConfirm={() => {
            pendingPaste.resolve(true);
            setPendingPaste(null);
          }}
          onCancel={() => {
            pendingPaste.resolve(false);
            setPendingPaste(null);
          }}
        />
      )}
      {fingerprintReq && (
        <FingerprintModal
          host={fingerprintReq.host}
          fingerprintBlock={fingerprintReq.fingerprintBlock}
          onAccept={() => fingerprintReq.resolve(true)}
          onReject={() => fingerprintReq.resolve(false)}
        />
      )}
      {fallbackReq && (
        <TmuxFallbackModal
          sessionName={fallbackReq.sessionName}
          exitCode={fallbackReq.exitCode}
          onReattach={() => {
            const tabId = fallbackReq.tabId;
            setFallbackReq(null);
            updateTab({ id: tabId, patch: { state: "idle", bannerMessage: undefined } });
          }}
          onRawShell={() => {
            const tabId = fallbackReq.tabId;
            setFallbackReq(null);
            
            // Spawn raw session for the active leaf pane
            const currentTab = tabs.find((t) => t.id === tabId);
            if (currentTab?.activePaneId) {
              void launchSession(tabId, currentTab.activePaneId, "raw");
            }
          }}
          onClose={() => {
            const tabId = fallbackReq.tabId;
            setFallbackReq(null);
            closeTab(tabId);
          }}
        />
      )}
      {missingTmuxReq && (
        <MissingTmuxModal
          onInstallLocal={() => {
            const tabId = missingTmuxReq.tabId;
            setMissingTmuxReq(null);
            const currentTab = tabs.find((t) => t.id === tabId);
            if (currentTab?.activePaneId) {
              void launchSession(tabId, currentTab.activePaneId, "install-local");
            }
          }}
          onClose={() => {
            const tabId = missingTmuxReq.tabId;
            setMissingTmuxReq(null);
            closeTab(tabId);
          }}
        />
      )}
      {renameWindowReq && (
        <RenameWindowModal
          currentName={renameWindowReq.currentName}
          identityLabel={renameWindowReq.identityLabel}
          title={renameWindowReq.kind === "pane" ? "Rename tmux pane" : "Rename tmux window"}
          fieldLabel={renameWindowReq.kind === "pane" ? "Pane title" : "Window name"}
          allowEmpty={renameWindowReq.kind === "pane"}
          onConfirm={(name) => {
            if (renameWindowReq.kind === "pane") {
              void submitRenamePane(renameWindowReq.paneId!, name);
            } else if (renameWindowReq.kind === "window-direct") {
              void submitRenameWindowDirect(renameWindowReq.target!, name);
            } else {
              void submitRenameWindow(renameWindowReq.paneId!, name);
            }
          }}
          onCancel={() => setRenameWindowReq(null)}
        />
      )}
      <span style={{ display: "none" }}>{tmuxVersionLabel ?? ""}</span>
    </div>
  );
}
