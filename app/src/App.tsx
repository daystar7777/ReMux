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
import { KeyPermissionsModal } from "./components/KeyPermissionsModal";
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

interface KeyPermissionRequest {
  keyPath: string;
  resolve: (choice: "fix" | "skip" | "cancel") => void;
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
  customTmuxBinary: host.custom_tmux_binary || undefined,
});

const activeBindings = new Map<string, SessionBinding>();
const activeLaunchingPanes = new Set<string>();

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
  const prevMousePolicyRef = useRef<Map<string, string>>(new Map());
  const pendingPaneFocusRef = useRef<{ sessionName: string; windowName: string; paneId: string } | null>(null);

  const termHandlesRef = useRef<Map<string, TerminalHandle>>(new Map());
  const viewModeRef = useRef(viewMode);
  const tabsRef = useRef(tabs);
  const [pendingPaste, setPendingPaste] = useState<PendingPaste | null>(null);
  const [fingerprintReq, setFingerprintReq] = useState<FingerprintRequest | null>(null);
  const [keyPermissionReq, setKeyPermissionReq] = useState<KeyPermissionRequest | null>(null);
  const [missingTmuxReq, setMissingTmuxReq] = useState<{ tabId: string; isLocal: boolean } | null>(null);
  const [renameWindowReq, setRenameWindowReq] = useState<RenameWindowRequest | null>(null);
  const [disconnectedPanes, setDisconnectedPanes] = useState<Map<string, {
    countdown: number;
    retryCount: number;
    bannerMessage?: string;
  }>>(new Map());
  const [hasSavedPassword, setHasSavedPassword] = useState<boolean>(false);
  
  // Track bindings via paneId instead of tabId
  const bindingsRef = useRef<Map<string, SessionBinding>>(activeBindings);
  const launchingPanesRef = useRef<Set<string>>(activeLaunchingPanes);

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
    const currentTab = tabsRef.current.find((t) => t.id === tabId);
    if (!currentTab) {
      console.warn(`[launchSession] Tab ${tabId} not found, aborting`);
      return false;
    }
    const targetProfile = profiles.find((p) => p.id === currentTab.profileId);
    const targetHost = targetProfile ? hosts.find((h) => h.id === targetProfile.host_id) : null;

    if (!targetProfile || !targetHost) {
      console.warn(`[launchSession] Profile or Host not found for tab ${tabId}, aborting`);
      return false;
    }

    if (launchingPanesRef.current.has(paneId)) {
      console.log(`[launchSession] already in progress for pane ${paneId}, skipping`);
      return false;
    }
    launchingPanesRef.current.add(paneId);

    // Terminate any existing PTY session for this pane to prevent zombie process/listener leaks
    const existingBinding = bindingsRef.current.get(paneId);
    if (existingBinding) {
      console.log(`[launchSession] Killing existing PTY session ${existingBinding.sessionId} for pane ${paneId}`);
      try {
        await ptyKill(existingBinding.sessionId);
      } catch (e) {
        console.warn("[launchSession] Failed to kill existing PTY session", e);
      }
      bindingsRef.current.delete(paneId);
    }

    // Clear any previous missing tmux or error states
    updateTab({
      id: tabId,
      patch: { missingTmuxRemote: false, state: "connecting" },
    });

    try {
      // Check private key permissions if using a key file for a remote connection
      if (targetHost.auth_method === "keyfile" && targetHost.key_path) {
        try {
          const isSafe = await invoke<boolean>("check_key_permissions", { keyPath: targetHost.key_path });
          if (!isSafe) {
            const userChoice = await new Promise<"fix" | "skip" | "cancel">((resolve) => {
              setKeyPermissionReq({
                keyPath: targetHost.key_path!,
                resolve,
              });
            });
            setKeyPermissionReq(null);

            if (userChoice === "cancel") {
              updateTab({
                id: tabId,
                patch: {
                  state: "error",
                  bannerMessage: "SSH connection cancelled because the private key file has unsafe permissions.",
                },
              });
              return false;
            } else if (userChoice === "fix") {
              updateTab({
                id: tabId,
                patch: {
                  state: "connecting",
                  bannerMessage: "Fixing key permissions...",
                },
              });
              try {
                await invoke("fix_key_permissions", { keyPath: targetHost.key_path });
              } catch (err) {
                console.error("Failed to fix key permissions:", err);
                updateTab({
                  id: tabId,
                  patch: {
                    state: "error",
                    bannerMessage: `Failed to fix key permissions: ${String(err)}`,
                  },
                });
                return false;
              }
            }
          }
        } catch (e) {
          console.warn("Failed to check key permissions, proceeding anyway", e);
        }
      }

      // 1. Pre-probe for tmux if connection is requested in tmux mode
      if (mode === "tmux") {
        if (targetHost.auth_method === "local") {
          const v = await tmuxLocalVersion();
          if (!v) {
            setMissingTmuxReq({ tabId, isLocal: true });
            return false;
          }
        } else if (targetHost.auth_method === "password") {
          // Password-authenticated hosts cannot be probed non-interactively.
          // Skip probe and proceed directly.
          console.log("Skipping remote env probe for password host:", targetHost.address);
        } else {
          try {
            updateTab({
              id: tabId,
              patch: { state: "connecting", bannerMessage: "Probing remote host..." },
            });
            const probe = await probeRemoteEnv({
              ...remoteSshArgs(targetHost),
            });
            setLocaleWarning(formatRemoteLocaleWarning(probe));
            if (probe && !probe.tmuxPresent) {
              updateTab({
                id: tabId,
                patch: { missingTmuxRemote: true },
              });
              launchingPanesRef.current.delete(paneId);
              void launchSession(tabId, paneId, "ssh-raw");
              return false;
            }
          } catch (e) {
            console.warn("Remote env probe failed, proceeding to direct connection", e);
          }
        }
      }

      const isLocalConnection = targetHost.auth_method === "local" || mode === "raw" || mode === "install-local";
      if (!isLocalConnection) {
        updateTab({
          id: tabId,
          patch: { state: "connecting", bannerMessage: undefined },
        });
      }

      let activeSessionId: string | null = null;
      let ptyDataBuffer = "";
      let seenInteractivePrompt = false;
      let connectionTimer: ReturnType<typeof setTimeout> | null = null;

      const cleanUpTimer = () => {
        if (connectionTimer) {
          clearTimeout(connectionTimer);
          connectionTimer = null;
        }
      };

      let transitionStarted = false;
      const transitionToConnected = (sid: string) => {
        if (transitionStarted) return;

        const currentTab = tabsRef.current.find((t) => t.id === tabId);
        if (!currentTab || currentTab.state === "connected") return;

        transitionStarted = true; // Mark as started immediately to prevent async concurrency!
        cleanUpTimer();
        console.log(`[launchSession] Transitioning tab ${tabId} to connected state`);

        void (async () => {
          if (targetHost.auth_method === "password") {
            try {
              const pubKey = await invoke<string>("get_local_ssh_public_key");
              
              // CRITICAL: Only write key provisioning command to remote shell if we are NOT inside a tmux session.
              // Writing shell commands to an active tmux session corrupts the screen and clutters the active pane.
              if (mode !== "tmux") {
                console.log("[launchSession] Provisioning local SSH public key on remote host shell...");
                const escapedPubKey = pubKey.replace(/'/g, "'\\''");
                const remoteCommand = `mkdir -p ~/.ssh && chmod 700 ~/.ssh && grep -qF '${escapedPubKey}' ~/.ssh/authorized_keys 2>/dev/null || echo '${escapedPubKey}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys\n`;
                setTimeout(() => {
                  void ptyWrite(sid, remoteCommand);
                }, 300);
              } else {
                console.log("[launchSession] Active tmux mode; skipping key provisioning shell command to avoid PTY corruption.");
                setTimeout(() => {
                  setMousePolicy("tmux");
                }, 300);
              }
            } catch (e) {
              console.warn("[launchSession] SSH key auto-provisioning skipped:", e);
            }
          } else {
            if (mode === "tmux") {
              setTimeout(() => {
                setMousePolicy("tmux");
              }, 300);
            }
          }

          let nextLayout = updateLayoutPty(currentTab.layout!, paneId, sid);
          if (mode === "tmux") {
            const identity = await resolveTmuxIdentity();
            nextLayout = updateLayoutTmuxIdentity(nextLayout, paneId, identity);
          }
          updateTab({
            id: tabId,
            patch: { layout: nextLayout, state: "connected" },
          });
        })();
      };

      const channel = new Channel<PtyEvent>();
      channel.onmessage = (evt) => {
        if (evt.kind === "data") {
          const handle = termHandlesRef.current.get(paneId);
          handle?.write(evt.data);

          if (!isLocalConnection) {
            const currentTab = tabsRef.current.find((t) => t.id === tabId);
            if (currentTab?.state !== "connected") {
              ptyDataBuffer += evt.data;
              if (ptyDataBuffer.length > 512) {
                ptyDataBuffer = ptyDataBuffer.slice(ptyDataBuffer.length - 512);
              }

              // Strip ANSI escape sequences to ensure reliable prompt detection
              const stripAnsi = (str: string) =>
                str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");

              const cleanBuffer = stripAnsi(ptyDataBuffer);
              const lowerClean = cleanBuffer.toLowerCase();
              const trimmedClean = lowerClean.trim();

              const isPrompt =
                trimmedClean.endsWith("password:") ||
                trimmedClean.endsWith("passphrase:") ||
                (trimmedClean.includes("password") && trimmedClean.endsWith("':")) ||
                (trimmedClean.includes("passphrase for key") && trimmedClean.endsWith(":")) ||
                lowerClean.includes("are you sure you want to continue connecting");

              const hasAuthFailure =
                lowerClean.includes("permission denied") ||
                lowerClean.includes("verification failed") ||
                lowerClean.includes("please try again") ||
                lowerClean.includes("incorrect passphrase") ||
                lowerClean.includes("try again") ||
                lowerClean.includes("login incorrect");

              const isSuccess =
                lowerClean.includes("last login:") ||
                lowerClean.includes("welcome to") ||
                lowerClean.includes("successful login") ||
                lowerClean.includes("authenticated") ||
                lowerClean.includes("microsoft windows") ||
                /[\$#%>]\s*$/.test(trimmedClean) ||
                evt.data.includes("\x1b[?1049h") ||
                ptyDataBuffer.toLowerCase().includes("\x1b[?1049h") ||
                lowerClean.includes("tmux");

              if (isPrompt) {
                if (!seenInteractivePrompt) {
                  console.log(`[launchSession] Interactive prompt detected in PTY stream`);
                }
                seenInteractivePrompt = true;
                cleanUpTimer();
              } else if (hasAuthFailure) {
                cleanUpTimer();
              } else {
                if (activeSessionId) {
                  if (isSuccess) {
                    transitionToConnected(activeSessionId);
                  } else if (seenInteractivePrompt && !isPrompt && !hasAuthFailure) {
                    cleanUpTimer();
                    connectionTimer = setTimeout(() => {
                      if (activeSessionId) {
                        transitionToConnected(activeSessionId);
                      }
                    }, 2000);
                  }
                }
              }
            }
          }

         } else if (evt.kind === "fingerprint") {
          cleanUpTimer();
          seenInteractivePrompt = true;
          setFingerprintReq({
            host: targetHost.address,
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
          cleanUpTimer();
          const binding = bindingsRef.current.get(paneId);
          bindingsRef.current.delete(paneId);

          // Remove the ptyId from the layout node
          const tab = tabs.find((t) => t.id === tabId);
          if (tab && tab.layout) {
            const nextLayout = updateLayoutPty(tab.layout, paneId, null);
            const isError255 = evt.code === 255;
            updateTab({
              id: tabId,
              patch: {
                layout: nextLayout,
                state: isError255 ? "error" : (binding?.kind === "tmux" ? "warning" : "closed"),
                bannerMessage: isError255
                  ? `SSH connection failed (code 255).`
                  : (binding?.kind === "tmux" ? `tmux session ended (code ${evt.code ?? "?"}).` : undefined),
              },
            });
          }

          if (binding) {
            if (evt.code !== 0 && targetHost && targetHost.auth_method !== "local") {
              if (evt.code === 255) {
                const lower = ptyDataBuffer.toLowerCase();
                const isKeyPermError =
                  targetHost.key_path &&
                  (lower.includes("unprotected private key") ||
                    lower.includes("bad permissions") ||
                    lower.includes("permissions") ||
                    lower.includes("accessible by others"));

                if (isKeyPermError) {
                  updateTab({
                    id: tabId,
                    patch: {
                      state: "error",
                       bannerMessage: `SSH connection failed (code 255) because your private key file (${targetHost.key_path!.split(/[/\\]/).pop()}) is unprotected and ignored by SSH.`,
                    },
                  });
                } else {
                  updateTab({
                    id: tabId,
                    patch: {
                      state: "error",
                      bannerMessage: `SSH connection failed (code 255). Please check your SSH credentials, ssh-agent status, or key permissions.`,
                    },
                  });
                }
                return;
              }

              if (binding.kind === "tmux") {
                setDisconnectedPanes((prev) => {
                  const next = new Map(prev);
                  next.set(paneId, {
                    countdown: 5,
                    retryCount: 0,
                    bannerMessage: `Remote tmux session disconnected abnormally (code ${evt.code ?? "unknown"}). Retrying to recover...`,
                  });
                  return next;
                });
              }
            } else {
              setFallbackReq({
                tabId,
                sessionName: targetProfile.tmux_session_name,
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
            targetHost.auth_method === "password"
              ? (await secretsGet(hostAccount(targetHost.id))) || undefined
              : undefined;
          sid = await ptySpawnSshTmux({
            ...remoteSshArgs(targetHost),
            tmuxSession: undefined,
            tmuxWindow: undefined,
            password: savedPw,
            detachOthers: targetHost.detach_other_clients,
            cols,
            rows,
            channel,
          });
        } else if (targetHost.auth_method === "local") {
          sid = await ptySpawnTmuxLocal({
            session: targetProfile.tmux_session_name,
            detachOthers: targetHost.detach_other_clients,
            window: targetProfile.tmux_window_target,
            socketPath: targetHost.tmux_socket_path,
            tmuxBinary: targetHost.custom_tmux_binary,
            cols,
            rows,
            channel,
            mouseMode: true,
          });
        } else {
          const savedPw =
            targetHost.auth_method === "password"
              ? (await secretsGet(hostAccount(targetHost.id))) || undefined
              : undefined;
          sid = await ptySpawnSshTmux({
            ...remoteSshArgs(targetHost),
            tmuxSession: targetProfile.tmux_session_name,
            tmuxWindow: targetProfile.tmux_window_target,
            password: savedPw,
            detachOthers: targetHost.detach_other_clients,
            cols,
            rows,
            channel,
            mouseMode: true,
          });
        }
        
        activeSessionId = sid;
        bindingsRef.current.set(paneId, {
          tabId,
          paneId,
          sessionId: sid,
          kind: (mode === "raw" || mode === "install-local" || mode === "ssh-raw") ? "raw" : "tmux",
        });

        // Trigger a re-render so that localEcho evaluates to false since sessionId is now available in bindingsRef
        updateTab({
          id: tabId,
          patch: { state: "connecting" },
        });

        if (isLocalConnection) {
          transitionToConnected(sid);
        } else {
          // Set a 1.5 second safety timer to auto-connect if no prompt is seen
          connectionTimer = setTimeout(() => {
            if (!seenInteractivePrompt) {
              console.log(`[launchSession] No prompt seen after 1.5s, auto-connecting`);
              transitionToConnected(sid);
            }
          }, 1500);
        }

        setViewMode("normal");

        if (mode === "install-local") {
          setTimeout(() => {
            void ptyWrite(sid, "brew install tmux\n");
          }, 500);
        }

        return true;
      } catch (err) {
        cleanUpTimer();
        console.error("session launch failed", err);
        updateTab({
          id: tabId,
          patch: { state: "error", bannerMessage: String(err) },
        });
        return false;
      }
    } finally {
      launchingPanesRef.current.delete(paneId);
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
      void launchSession(activeTab.id, newPaneId, isTmux ? "tmux" : (activeHost?.auth_method === "local" ? "raw" : "ssh-raw"));
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

  const handlePaneSelect = (paneId: string) => {
    pendingPaneFocusRef.current = null;
    const binding = bindingsRef.current.get(paneId);
    if (binding?.kind === "tmux" && supportsNativeTmuxCommands(activeHost)) {
      void executeTmuxCommand("select", paneId);
    }
  };

  const handleSelectPane = async (
    sessionName: string,
    windowName: string,
    paneId: string,
    _paneIndex: number
  ) => {
    if (!activeTab || !activeProfile || !activeHost) return;

    const isSessionActive = activeProfile.tmux_session_name === sessionName;
    const isWindowActive = isSessionActive && activeProfile.tmux_window_target === windowName;

    // 1. If not connected to this session or window, attach to it!
    if (!isSessionActive || !isWindowActive) {
      pendingPaneFocusRef.current = { sessionName, windowName, paneId };
      await handleAttachToTarget(sessionName, windowName);
      return;
    } else {
      pendingPaneFocusRef.current = null;
    }

    // 2. If it is already the active window and session, let's see if this pane is in our ReMux layout.
    if (activeTab.layout) {
      const findLayoutPaneIdByTmuxPaneId = (node: PaneLayout, targetPaneId: string): string | null => {
        if (node.type === "leaf") {
          return node.tmuxIdentity?.paneId === targetPaneId ? node.id : null;
        }
        for (const child of node.children) {
          const found = findLayoutPaneIdByTmuxPaneId(child, targetPaneId);
          if (found) return found;
        }
        return null;
      };

      const matchingPaneId = findLayoutPaneIdByTmuxPaneId(activeTab.layout, paneId);
      if (matchingPaneId) {
        // Already active? Avoid useless re-renders.
        if (activeTab.activePaneId !== matchingPaneId) {
          updateTab({
            id: activeTab.id,
            patch: { activePaneId: matchingPaneId },
          });
        }

        // Focus the terminal handle!
        const handle = termHandlesRef.current.get(matchingPaneId);
        if (handle) {
          handle.focus();
        }

        // Also trigger native tmux select-pane command if supported out-of-band
        if (supportsNativeTmuxCommands(activeHost)) {
          void executeTmuxCommand("select", matchingPaneId);
        }
      } else {
        // If it is not in our ReMux layout (meaning it's a native split inside a single ReMux pane),
        // we can trigger native tmux select-pane command out-of-band for the active pane.
        if (supportsNativeTmuxCommands(activeHost)) {
          try {
            if (activeHost.auth_method === "local") {
              await tmuxSelectLocalPane({
                target: paneId,
                binary: activeHost.custom_tmux_binary || undefined,
                socketPath: activeHost.tmux_socket_path || undefined,
              });
            } else {
              await tmuxSelectRemotePane({
                ...remoteSshArgs(activeHost),
                target: paneId,
                tmuxBinary: activeHost.custom_tmux_binary || undefined,
                socketPath: activeHost.tmux_socket_path || undefined,
              });
            }
            // Trigger background refresh of layout and pane list
            window.setTimeout(() => {
              void refreshActiveTmuxState();
            }, 100);
          } catch (err) {
            console.warn("Failed to select remote pane out-of-band", err);
          }
        }
      }
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

  // 4. Saved password detection for active host
  useEffect(() => {
    const checkPassword = async () => {
      if (activeHost && activeHost.auth_method === "password") {
        try {
          const pw = await secretsGet(hostAccount(activeHost.id));
          setHasSavedPassword(!!pw);
        } catch (e) {
          console.warn("Failed to check saved password", e);
          setHasSavedPassword(false);
        }
      } else {
        setHasSavedPassword(false);
      }
    };
    void checkPassword();
  }, [activeHost]);

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

    const activePaneId = activeTab.activePaneId;
    const binding = activePaneId ? bindingsRef.current.get(activePaneId) : null;
    if (binding?.kind !== "tmux") return;

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
  }, [activeTab?.id, activeTab?.activePaneId, activeTab?.state, activeHost, setHierarchyRecord, hierarchyInterval, hasSavedPassword]);

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

    const activePaneId = activeTab.activePaneId;
    const binding = activePaneId ? bindingsRef.current.get(activePaneId) : null;
    if (binding?.kind !== "tmux") return;

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
    hasSavedPassword,
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

    const activePaneId = activeTab.activePaneId;
    const binding = activePaneId ? bindingsRef.current.get(activePaneId) : null;
    if (binding?.kind !== "tmux") return;

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
    activeTab?.activePaneId,
    activeTab?.state,
    activeHost,
    activeProfile,
    telemetryInterval,
    refreshPaneIdentities,
    hasSavedPassword,
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

  // 2.3 Auto-focus pending pane across session/window connections
  useEffect(() => {
    if (!activeTab || activeTab.state !== "connected" || !activeTab.layout) return;
    if (pendingPaneFocusRef.current) {
      const { sessionName, windowName, paneId } = pendingPaneFocusRef.current;
      
      if (
        activeProfile?.tmux_session_name === sessionName &&
        activeProfile?.tmux_window_target === windowName
      ) {
        const findMatchingLeafId = (node: PaneLayout): string | null => {
          if (node.type === "leaf") {
            return node.tmuxIdentity?.paneId === paneId ? node.id : null;
          }
          for (const child of node.children) {
            const found = findMatchingLeafId(child);
            if (found) return found;
          }
          return null;
        };

        const matchingReMuxPaneId = findMatchingLeafId(activeTab.layout);
        if (matchingReMuxPaneId) {
          pendingPaneFocusRef.current = null; // Clear pending focus
          
          if (activeTab.activePaneId !== matchingReMuxPaneId) {
            updateTab({
              id: activeTab.id,
              patch: { activePaneId: matchingReMuxPaneId },
            });
          }
          const handle = termHandlesRef.current.get(matchingReMuxPaneId);
          if (handle) {
            handle.focus();
          }
          if (supportsNativeTmuxCommands(activeHost)) {
            void executeTmuxCommand("select", matchingReMuxPaneId);
          }
        }
      }
    }
  }, [activeTab?.state, activeTab?.layout, activeProfile, activeHost]);

  useEffect(() => {
    if (!activeTab || activeTab.state !== "connected" || !activeHost || !activeProfile) return;

    const activePaneId = activeTab.activePaneId;
    const binding = activePaneId ? bindingsRef.current.get(activePaneId) : null;
    if (binding?.kind !== "tmux") return;

    const target = activeProfile.tmux_session_name;
    if (!target) return;

    // Strict infinite-loop guard: only execute out-of-band mouse set command
    // when the mouse policy has genuinely changed for this specific tab.
    const prev = prevMousePolicyRef.current.get(activeTab.id);
    if (prev === mousePolicy) {
      return;
    }
    prevMousePolicyRef.current.set(activeTab.id, mousePolicy);

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
          // Password-auth host: we cannot run native out-of-band commands to enable/disable tmux mouse mode.
          // But we STILL allow the user to use 'tmux' pass-through mode if they enable it in tmux manually!
          updateTab({
            id: activeTab.id,
            patch: {
              bannerMessage: enabled
                ? "Mouse pass-through enabled. Since native mouse sync is unavailable on this host, please ensure 'set -g mouse on' is enabled in your remote tmux session."
                : undefined,
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
      }
    };

    void syncMousePolicy();
  }, [activeTab?.id, activeHost, activeProfile, mousePolicy]);

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
    // 1. Safe boundary: Ignore collapsed/hidden state resizes to prevent remote buffer corruption
    if (cols <= 5 || rows <= 5) return;

    // 2. Active tab check: Lock inactive background PTY sizes at their last stable values
    const isActiveTabPane = (() => {
      if (!activeTab || !activeTab.layout) return false;
      const checkPane = (node: PaneLayout): boolean => {
        if (node.type === "leaf") return node.id === paneId;
        return node.children.some(checkPane);
      };
      return checkPane(activeTab.layout);
    })();

    if (!isActiveTabPane) return;

    const binding = bindingsRef.current.get(paneId);
    if (binding?.sessionId) {
      void ptyResize(binding.sessionId, cols, rows);
    }
  };

  const onDoubleClick = async (paneId: string) => {
    setViewMode((m) => (m === "focus" ? "normal" : "focus"));
    const binding = bindingsRef.current.get(paneId);
    if (binding?.kind === "tmux") {
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
          onSelectPane={handleSelectPane}
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
              {activeTab.state === "error" && activeHost && activeHost.auth_method !== "local" && (
                <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                  {!activeHost.skip_host_key_check && activeTab.bannerMessage.includes("code 255") && (
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
                  {activeHost.key_path &&
                    (activeTab.bannerMessage.includes("unprotected") ||
                      activeTab.bannerMessage.includes("permissions") ||
                      activeTab.bannerMessage.includes("ignored")) && (
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
                          try {
                            updateTab({
                              id: activeTab.id,
                              patch: {
                                state: "connecting",
                                bannerMessage: "Fixing key permissions...",
                              },
                            });
                            await invoke("fix_key_permissions", { keyPath: activeHost.key_path! });
                            
                            const paneId = activeTab.activePaneId;
                            if (paneId) {
                              updateTab({
                                id: activeTab.id,
                                patch: {
                                  state: "connecting",
                                  bannerMessage: "Retrying connection...",
                                },
                              });
                              void launchSession(activeTab.id, paneId, "tmux");
                            }
                          } catch (err) {
                            console.error("Failed to fix key permissions:", err);
                            updateTab({
                              id: activeTab.id,
                              patch: {
                                state: "error",
                                bannerMessage: `Failed to fix key permissions: ${String(err)}`,
                              },
                            });
                          }
                        }}
                      >
                        Fix Key Permissions &amp; Retry
                      </button>
                    )}
                </div>
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
          {tabs.map((tab) => {
            const isTabActive = tab.id === activeTab?.id;
            const profile = profiles.find((p) => p.id === tab.profileId);
            const host = profile ? hosts.find((h) => h.id === profile.host_id) : null;
            return (
              <div
                key={tab.id}
                style={{
                  display: isTabActive ? "flex" : "none",
                  flexDirection: "column",
                  flex: 1,
                  minWidth: 0,
                  height: "100%",
                }}
              >
                {tab.layout && (
                  <TerminalGrid
                    tabId={tab.id}
                    layout={tab.layout}
                    activePaneId={isTabActive ? tab.activePaneId : undefined}
                    termHandlesRef={termHandlesRef}
                    onInput={onTerminalInput}
                    onResize={onTerminalResize}
                    onDoubleClick={onDoubleClick}
                    onPasteRequested={(req) => setPendingPaste(req)}
                    onPaneCreated={(paneId) => {
                      void launchSession(tab.id, paneId, "tmux");
                    }}
                    localEcho={
                      tab.state !== "connected" && (
                        !tab.activePaneId || 
                        !bindingsRef.current.get(tab.activePaneId)?.sessionId
                      )
                    }
                    disconnectedPanes={disconnectedPanes}
                    onRetryPane={handleRetryPane}
                    onClosePane={handleClosePane}
                    onSplitPane={handleSplitPane}
                    onApplyLayoutPreset={handleApplyLayoutPreset}
                    onRenameWindow={handleRenameWindow}
                    onRenamePane={handleRenamePane}
                    nativeRenameDisabledReason={
                      nativeTmuxDisabledReason(host, "Native tmux rename")
                    }
                    onPaneSelect={handlePaneSelect}
                  />
                )}
              </div>
            );
          })}
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
      {keyPermissionReq && (
        <KeyPermissionsModal
          keyPath={keyPermissionReq.keyPath}
          onFix={() => keyPermissionReq.resolve("fix")}
          onSkip={() => keyPermissionReq.resolve("skip")}
          onCancel={() => keyPermissionReq.resolve("cancel")}
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
              void launchSession(tabId, currentTab.activePaneId, activeHost?.auth_method === "local" ? "raw" : "ssh-raw");
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
