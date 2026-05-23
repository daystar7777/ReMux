import React, { useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { ChevronRight, ChevronDown, Terminal, Layers, Folder, RefreshCw, Plus, SquarePen, Trash2 } from "lucide-react";
import {
  activeTabAtom,
  activeHostAtom,
  activeProfileAtom,
  inventorySidebarCollapsedAtom,
  tmuxHierarchyAtom,
} from "../state/atoms";
import { tmuxProbeHierarchy } from "../lib/ipc";

interface InventorySidebarProps {
  onAttachToTarget: (sessionName: string, windowName?: string) => void;
  onNewWindow?: (sessionName: string) => void;
  onKillWindow?: (sessionName: string, windowId: string, windowName: string) => void;
  onRenameWindow?: (sessionName: string, windowId: string, windowName: string) => void;
  onSelectPane?: (sessionName: string, windowName: string, paneId: string, paneIndex: number) => void;
}

export const InventorySidebar: React.FC<InventorySidebarProps> = ({
  onAttachToTarget,
  onNewWindow,
  onKillWindow,
  onRenameWindow,
  onSelectPane,
}) => {
  const [collapsed, setCollapsed] = useAtom(inventorySidebarCollapsedAtom);
  const activeTab = useAtomValue(activeTabAtom);
  const activeHost = useAtomValue(activeHostAtom);
  const activeProfile = useAtomValue(activeProfileAtom);
  const [hierarchyRecord, setHierarchyRecord] = useAtom(tmuxHierarchyAtom);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Keep track of collapsed nodes locally
  const [collapsedNodes, setCollapsedNodes] = useState<Record<string, boolean>>({});

  const toggleNode = (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedNodes((prev) => ({
      ...prev,
      [nodeId]: !prev[nodeId],
    }));
  };

  const sessions = activeTab ? hierarchyRecord[activeTab.id] || [] : [];

  const handleRefresh = async () => {
    if (!activeTab || !activeHost || isRefreshing) return;
    setIsRefreshing(true);
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
      console.warn("Manual inventory refresh failed", e);
    } finally {
      setIsRefreshing(false);
    }
  };

  if (collapsed) {
    return null;
  }

  return (
    <aside
      className="inventory-sidebar"
      style={{
        width: "230px",
        background: "var(--glass-bg)",
        backdropFilter: "blur(20px)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      {/* Header Area */}
      <div
        style={{
          height: "36px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 10px 0 12px",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--fg-1)",
          }}
        >
          Tmux Inventory
        </span>
        <div style={{ display: "flex", gap: "6px" }}>
          <button
            className="icon-btn"
            onClick={handleRefresh}
            title="Refresh Hierarchy"
            disabled={!activeTab || isRefreshing}
            style={{ width: "20px", height: "20px", padding: 0, border: "none" }}
          >
            <RefreshCw size={10} className={isRefreshing ? "spin" : ""} />
          </button>
          <button
            className="icon-btn"
            onClick={() => setCollapsed(true)}
            title="Collapse Panel"
            style={{
              width: "20px",
              height: "20px",
              padding: 0,
              border: "none",
              fontSize: "10px",
              fontWeight: 600,
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Tree Content */}
      <div
        className="inventory-tree-scroll"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "8px 4px",
          display: "flex",
          flexDirection: "column",
          gap: "2px",
        }}
      >
        {!activeTab ? (
          <div style={{ padding: "12px", fontSize: "11px", color: "var(--fg-3)", textAlign: "center" }}>
            No active connection
          </div>
        ) : sessions.length === 0 ? (
          <div style={{ padding: "12px", fontSize: "11px", color: "var(--fg-3)", textAlign: "center" }}>
            No active tmux sessions found.
          </div>
        ) : (
          sessions.map((session) => {
            const isSessionCollapsed = !!collapsedNodes[`s_${session.sessionId}`];
            const isSessionActive = activeProfile?.tmux_session_name === session.sessionName;

            return (
              <div key={session.sessionId} style={{ display: "flex", flexDirection: "column" }}>
                {/* Session Node */}
                <div
                  className={`tree-node session-node ${isSessionActive ? "active" : ""}`}
                  onClick={() => {
                    setCollapsedNodes((prev) => ({
                      ...prev,
                      [`s_${session.sessionId}`]: !prev[`s_${session.sessionId}`],
                    }));
                    onAttachToTarget(session.sessionName);
                  }}
                  onDoubleClick={() => onAttachToTarget(session.sessionName)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "6px 8px",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "11px",
                    fontWeight: isSessionActive ? 600 : 500,
                    color: isSessionActive ? "var(--accent)" : "var(--fg-1)",
                    gap: "6px",
                    transition: "all 0.15s ease",
                    userSelect: "none",
                    position: "relative",
                  }}
                >
                  <div
                    onClick={(e) => toggleNode(`s_${session.sessionId}`, e)}
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "12px" }}
                  >
                    {isSessionCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  </div>
                  <Folder size={12} style={{ color: isSessionActive ? "var(--accent)" : "var(--fg-2)" }} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {session.sessionName}
                  </span>
                  {isSessionActive && (
                    <span
                      style={{
                        width: "6px",
                        height: "6px",
                        borderRadius: "50%",
                        background: "var(--ok)",
                        boxShadow: "0 0 6px var(--ok)",
                      }}
                    />
                  )}
                  {onNewWindow && (
                    <div className="tree-node-actions">
                      <button
                        className="tree-node-btn"
                        title="New Window"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          onNewWindow(session.sessionName);
                        }}
                      >
                        <Plus size={11} />
                      </button>
                    </div>
                  )}
                </div>

                {/* Windows Tree */}
                {!isSessionCollapsed && (
                  <div style={{ paddingLeft: "14px", display: "flex", flexDirection: "column", gap: "2px" }}>
                    {session.windows.map((window) => {
                      const isWindowCollapsed = !!collapsedNodes[`w_${window.windowId}`];
                      const isWindowActive =
                        isSessionActive && activeProfile?.tmux_window_target === window.windowName;

                      return (
                        <div key={window.windowId} style={{ display: "flex", flexDirection: "column" }}>
                          {/* Window Node */}
                          <div
                            className={`tree-node window-node ${isWindowActive ? "active" : ""}`}
                            onClick={() => {
                              setCollapsedNodes((prev) => ({
                                ...prev,
                                [`w_${window.windowId}`]: !prev[`w_${window.windowId}`],
                              }));
                              onAttachToTarget(session.sessionName, window.windowName);
                            }}
                            onDoubleClick={() => onAttachToTarget(session.sessionName, window.windowName)}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              padding: "4px 8px",
                              borderRadius: "4px",
                              cursor: "pointer",
                              fontSize: "11px",
                              color: isWindowActive ? "var(--accent)" : "var(--fg-1)",
                              gap: "6px",
                              transition: "all 0.15s ease",
                              userSelect: "none",
                              position: "relative",
                            }}
                          >
                            <div
                              onClick={(e) => toggleNode(`w_${window.windowId}`, e)}
                              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "12px" }}
                            >
                              {isWindowCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                            </div>
                            <Layers size={12} style={{ color: isWindowActive ? "var(--accent)" : "var(--fg-2)" }} />
                            <span
                              style={{
                                flex: 1,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {window.windowIndex}: {window.windowName}
                            </span>
                            {isWindowActive && (
                              <span
                                style={{
                                  width: "5px",
                                  height: "5px",
                                  borderRadius: "50%",
                                  background: "var(--ok)",
                                }}
                              />
                            )}
                            <div className="tree-node-actions">
                              {onRenameWindow && (
                                <button
                                  className="tree-node-btn"
                                  title="Rename Window"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    onRenameWindow(session.sessionName, window.windowId, window.windowName);
                                  }}
                                >
                                  <SquarePen size={11} />
                                </button>
                              )}
                              {onKillWindow && (
                                <button
                                  className="tree-node-btn danger"
                                  title="Kill Window"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    if (confirm(`Are you sure you want to kill window "${window.windowName}" (${window.windowId})?`)) {
                                      onKillWindow(session.sessionName, window.windowId, window.windowName);
                                    }
                                  }}
                                >
                                  <Trash2 size={11} />
                                </button>
                              )}
                            </div>
                          </div>
                          {window.windowLayout && !isWindowCollapsed && (
                            <div
                              title={`tmux layout: ${window.windowLayout}`}
                              style={{
                                margin: "0 8px 2px 32px",
                                color: "var(--fg-3)",
                                fontSize: "9px",
                                lineHeight: 1.2,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                fontFamily: "var(--mono)",
                              }}
                            >
                              layout {window.windowLayout}
                            </div>
                          )}

                          {/* Panes Tree */}
                          {!isWindowCollapsed && (
                            <div style={{ paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "2px" }}>
                              {window.panes.map((pane) => {
                                const activeLeaf = activeTab?.layout?.type === "leaf" ? activeTab.layout : null; // simplified active leaf detection
                                const isPaneFocused = activeLeaf?.tmuxIdentity?.paneId === pane.paneId;

                                return (
                                  <div
                                    key={pane.paneId}
                                    className={`tree-node pane-node ${isPaneFocused ? "active" : ""}`}
                                    onClick={() => {
                                      onSelectPane?.(
                                        session.sessionName,
                                        window.windowName,
                                        pane.paneId,
                                        pane.paneIndex
                                      );
                                    }}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      padding: "3px 8px 3px 18px",
                                      borderRadius: "4px",
                                      cursor: "pointer",
                                      fontSize: "10.5px",
                                      color: isPaneFocused ? "var(--accent)" : "var(--fg-2)",
                                      gap: "6px",
                                      transition: "all 0.15s ease",
                                      userSelect: "none",
                                    }}
                                  >
                                    <Terminal size={10} style={{ color: isPaneFocused ? "var(--accent)" : "var(--fg-3)" }} />
                                    <span
                                      style={{
                                        flex: 1,
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                      }}
                                    >
                                      %{pane.paneIndex} {pane.paneCurrentCommand ? `(${pane.paneCurrentCommand})` : ""}
                                    </span>
                                    {pane.panePid && (
                                      <span style={{ fontSize: "9px", color: "var(--fg-3)" }}>
                                        PID {pane.panePid}
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
