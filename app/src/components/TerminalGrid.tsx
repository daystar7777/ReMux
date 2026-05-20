import React from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Terminal, type PasteRequest, type TerminalHandle } from "./Terminal";
import { openTabsAtom, type PaneLayout, splitPaneAction, closePaneAction, viewModeAtom, applyPresetAction } from "../state/atoms";
import type { TmuxLayoutPreset } from "../lib/ipc";
import { Columns, Pencil, Rows, Tag, X, LayoutGrid } from "lucide-react";
import { RecoveryOverlay } from "./RecoveryOverlay";
import {
  parseTmuxLayout,
  tmuxPaneIdToLayoutPaneId,
  type TmuxLayoutNode,
} from "../lib/tmuxLayout";

interface TerminalGridProps {
  tabId: string;
  layout: PaneLayout;
  activePaneId?: string;
  termHandlesRef: React.MutableRefObject<Map<string, TerminalHandle>>;
  onInput: (paneId: string, data: string) => void;
  onResize: (paneId: string, cols: number, rows: number) => void;
  onDoubleClick: (paneId: string) => void;
  onPasteRequested: (req: PasteRequest) => void;
  onPaneCreated: (paneId: string) => void;
  localEcho: boolean;
  disconnectedPanes?: Map<string, { countdown: number; bannerMessage?: string }>;
  onRetryPane?: (paneId: string) => void;
  onClosePane?: (paneId: string) => void;
  onSplitPane?: (paneId: string, direction: "row" | "column") => void;
  onApplyLayoutPreset?: (paneId: string, preset: TmuxLayoutPreset) => void;
  onRenameWindow?: (paneId: string) => void;
  onRenamePane?: (paneId: string) => void;
  nativeRenameDisabledReason?: string;
}

export const TerminalGrid: React.FC<TerminalGridProps> = ({
  tabId,
  layout,
  activePaneId,
  termHandlesRef,
  onInput,
  onResize,
  onDoubleClick,
  onPasteRequested,
  onPaneCreated,
  localEcho,
  disconnectedPanes,
  onRetryPane,
  onClosePane,
  onSplitPane,
  onApplyLayoutPreset,
  onRenameWindow,
  onRenamePane,
  nativeRenameDisabledReason,
}) => {
  const [tabs, setTabs] = useAtom(openTabsAtom);
  const splitPane = useSetAtom(splitPaneAction);
  const closePane = useSetAtom(closePaneAction);
  const applyPreset = useSetAtom(applyPresetAction);
  const viewMode = useAtomValue(viewModeAtom);
  const [showPresetDropdownId, setShowPresetDropdownId] = React.useState<string | null>(null);

  const renderTmuxLayoutPreview = (node: TmuxLayoutNode, activeLayoutPaneId?: string): React.ReactNode => {
    if (node.type === "pane") {
      const isActive = node.paneId === activeLayoutPaneId;
      return (
        <div
          className={`tmux-layout-pane${isActive ? " active" : ""}`}
          title={`tmux pane ${node.paneId} · ${node.width}x${node.height}+${node.x}+${node.y}`}
        >
          <span>%{node.paneId}</span>
        </div>
      );
    }
    return (
      <div className={`tmux-layout-branch ${node.type}`}>
        {node.children.map((child, index) => (
          <React.Fragment key={`${child.type}-${index}-${child.x}-${child.y}`}>
            {renderTmuxLayoutPreview(child, activeLayoutPaneId)}
          </React.Fragment>
        ))}
      </div>
    );
  };

  const hasActivePaneDescendant = (node: PaneLayout, activeId: string): boolean => {
    if (node.type === "leaf") return node.id === activeId;
    return node.children.some((child) => hasActivePaneDescendant(child, activeId));
  };

  const selectPane = (paneId: string) => {
    setTabs(
      tabs.map((t) => {
        if (t.id === tabId) {
          return { ...t, activePaneId: paneId };
        }
        return t;
      })
    );
  };

  const countLeaves = (node: PaneLayout): number => {
    if (node.type === "leaf") return 1;
    return node.children.reduce((acc, child) => acc + countLeaves(child), 0);
  };

  const leafCount = countLeaves(layout);
  const canClose = leafCount > 1;

  const renderNode = (node: PaneLayout): React.ReactNode => {
    const isFocusMode = viewMode === "focus";
    const isActiveOrDescendant = activePaneId ? hasActivePaneDescendant(node, activePaneId) : false;
    const shouldHide = isFocusMode && !isActiveOrDescendant;

    if (node.type === "leaf") {
      const isActive = node.id === activePaneId;
      const discState = disconnectedPanes?.get(node.id);
      const hasTmuxIdentity = Boolean(node.tmuxIdentity);
      const identityMode = hasTmuxIdentity ? "tmux" : "unknown";
      const isLayoutMode = viewMode === "layout";
      const parsedTmuxLayout = parseTmuxLayout(node.tmuxIdentity?.windowLayout);
      const activeLayoutPaneId = tmuxPaneIdToLayoutPaneId(node.tmuxIdentity?.paneId);
      const canRenameNative = hasTmuxIdentity && !nativeRenameDisabledReason;
      const splitFallbackTitle = hasTmuxIdentity
        ? "Native tmux split"
        : "REMUX local split fallback; native tmux identity is unknown";
      return (
        <div
          key={node.id}
          data-pane-id={node.id}
          className={`terminal-pane-wrapper ${isActive ? "active" : ""}`}
          onClick={() => selectPane(node.id)}
          style={{
            flex: 1,
            display: shouldHide ? "none" : "flex",
            flexDirection: "column",
            border: "2px solid transparent",
            borderRadius: "8px",
            overflow: "hidden",
            boxSizing: "border-box",
            transition: "border-color 0.15s ease",
            margin: "2px",
            minWidth: 0,
            minHeight: 0,
            background: "var(--bg-0)",
            position: "relative",
          }}
        >
          {/* Elegant Pane Title / Header Bar */}
          <div
            className="pane-header"
            style={{
              height: "28px",
              background: isActive ? "var(--bg-3)" : "var(--bg-1)",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 8px",
              fontSize: "11px",
              color: isActive ? "var(--fg-0)" : "var(--fg-2)",
              transition: "background 0.15s ease, color 0.15s ease",
              boxSizing: "border-box",
              userSelect: "none",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: node.ptyId ? "var(--ok)" : (discState ? "var(--danger)" : "var(--warn)"),
                  boxShadow: node.ptyId ? "0 0 6px var(--ok)" : (discState ? "0 0 6px var(--danger)" : "none"),
                  transition: "all 0.2s ease",
                }}
              />
              <span style={{ fontWeight: 600, letterSpacing: "0.04em" }}>
                {node.tmuxIdentity
                  ? `${node.tmuxIdentity.sessionName}:${node.tmuxIdentity.windowIndex}.${node.tmuxIdentity.paneIndex}`
                  : `PANE ${node.id.slice(-4).toUpperCase()}`}
              </span>
              {node.tmuxIdentity?.paneCurrentCommand && (
                <span style={{ color: "var(--fg-2)", fontWeight: 500 }}>
                  {node.tmuxIdentity.paneCurrentCommand}
                </span>
              )}
              {node.tmuxIdentity?.paneTitle && (
                <span
                  title={`Pane title: ${node.tmuxIdentity.paneTitle}`}
                  style={{
                    color: "var(--accent)",
                    fontWeight: 600,
                    maxWidth: "120px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {node.tmuxIdentity.paneTitle}
                </span>
              )}
              <span
                title={
                  identityMode === "tmux"
                    ? "Native tmux pane identity is known."
                    : "Native tmux identity is not known; REMUX will use local pane fallback behavior for split/close actions."
                }
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                  color: identityMode === "tmux" ? "var(--ok)" : "var(--fg-3)",
                  fontSize: "9px",
                  fontWeight: 700,
                  padding: "1px 4px",
                  textTransform: "uppercase",
                }}
              >
                {identityMode}
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "2px" }} onClick={(e) => e.stopPropagation()}>
              <button
                className="icon-btn"
                disabled={!canRenameNative || !onRenameWindow}
                onClick={() => onRenameWindow?.(node.id)}
                title={
                  nativeRenameDisabledReason
                    ? nativeRenameDisabledReason
                    : hasTmuxIdentity
                    ? "Rename tmux window"
                    : "Rename requires a known native tmux pane identity"
                }
                style={{
                  width: "22px",
                  height: "22px",
                  padding: 0,
                  border: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: canRenameNative ? 1 : 0.35,
                }}
              >
                <Pencil size={11} />
              </button>
              <button
                className="icon-btn"
                disabled={!canRenameNative || !onRenamePane}
                onClick={() => onRenamePane?.(node.id)}
                title={
                  nativeRenameDisabledReason
                    ? nativeRenameDisabledReason
                    : hasTmuxIdentity
                    ? "Rename tmux pane title"
                    : "Pane title requires a known native tmux pane identity"
                }
                style={{
                  width: "22px",
                  height: "22px",
                  padding: 0,
                  border: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: canRenameNative ? 1 : 0.35,
                }}
              >
                <Tag size={11} />
              </button>
              <div style={{ position: "relative" }}>
                <button
                  className="icon-btn"
                  onClick={() => setShowPresetDropdownId(showPresetDropdownId === node.id ? null : node.id)}
                  title="Apply Layout Preset"
                  style={{
                    width: "22px",
                    height: "22px",
                    padding: 0,
                    border: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <LayoutGrid size={11} />
                </button>
                {showPresetDropdownId === node.id && (
                  <div
                    className="presets-dropdown"
                    onMouseLeave={() => setShowPresetDropdownId(null)}
                    style={{
                      position: "absolute",
                      top: "100%",
                      right: 0,
                      zIndex: 1000,
                      marginTop: "4px",
                      background: "var(--bg-1)",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.4)",
                      padding: "4px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "2px",
                      minWidth: "120px",
                      backdropFilter: "blur(20px)",
                    }}
                  >
                    <button
                      className="dropdown-item"
                      onClick={() => {
                        if (onApplyLayoutPreset) onApplyLayoutPreset(node.id, "even");
                        else applyPreset({ tabId, preset: "even" });
                        setShowPresetDropdownId(null);
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        borderRadius: "4px",
                        color: "var(--fg-1)",
                        cursor: "pointer",
                        fontSize: "10.5px",
                        padding: "6px 8px",
                        textAlign: "left",
                        width: "100%",
                      }}
                    >
                      Even Grid
                    </button>
                    <button
                      className="dropdown-item"
                      onClick={() => {
                        if (onApplyLayoutPreset) onApplyLayoutPreset(node.id, "main-left");
                        else applyPreset({ tabId, preset: "main-left" });
                        setShowPresetDropdownId(null);
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        borderRadius: "4px",
                        color: "var(--fg-1)",
                        cursor: "pointer",
                        fontSize: "10.5px",
                        padding: "6px 8px",
                        textAlign: "left",
                        width: "100%",
                      }}
                    >
                      Main Left Stack
                    </button>
                    <button
                      className="dropdown-item"
                      onClick={() => {
                        if (onApplyLayoutPreset) onApplyLayoutPreset(node.id, "main-top");
                        else applyPreset({ tabId, preset: "main-top" });
                        setShowPresetDropdownId(null);
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        borderRadius: "4px",
                        color: "var(--fg-1)",
                        cursor: "pointer",
                        fontSize: "10.5px",
                        padding: "6px 8px",
                        textAlign: "left",
                        width: "100%",
                      }}
                    >
                      Main Top Stack
                    </button>
                  </div>
                )}
              </div>
              <button
                className="icon-btn"
                onClick={() => {
                  if (onSplitPane) {
                    onSplitPane(node.id, "column");
                  } else {
                    const newPaneId = splitPane({ tabId, paneId: node.id, direction: "column" });
                    if (newPaneId) onPaneCreated(newPaneId);
                  }
                }}
                title={`${splitFallbackTitle} vertically`}
                style={{
                  width: "22px",
                  height: "22px",
                  padding: 0,
                  border: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Columns size={11} />
              </button>
              <button
                className="icon-btn"
                onClick={() => {
                  if (onSplitPane) {
                    onSplitPane(node.id, "row");
                  } else {
                    const newPaneId = splitPane({ tabId, paneId: node.id, direction: "row" });
                    if (newPaneId) onPaneCreated(newPaneId);
                  }
                }}
                title={`${splitFallbackTitle} horizontally`}
                style={{
                  width: "22px",
                  height: "22px",
                  padding: 0,
                  border: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Rows size={11} />
              </button>
              {canClose && (
                <button
                  className="icon-btn"
                  onClick={() => {
                    if (onClosePane) {
                      onClosePane(node.id);
                    } else {
                      closePane({ tabId, paneId: node.id });
                    }
                  }}
                  title="Close Pane"
                  style={{
                    width: "22px",
                    height: "22px",
                    padding: 0,
                    border: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--danger)",
                  }}
                >
                  <X size={11} />
                </button>
              )}
            </div>
          </div>

          {/* Actual Terminal Stream */}
          <Terminal
            ref={(el) => {
              if (el) termHandlesRef.current.set(node.id, el);
              else termHandlesRef.current.delete(node.id);
            }}
            localEcho={localEcho}
            onInput={(data) => onInput(node.id, data)}
            onResize={(cols, rows) => onResize(node.id, cols, rows)}
            onDoubleClick={() => onDoubleClick(node.id)}
            onPasteRequested={onPasteRequested}
          />

          {isLayoutMode && (
            <div className="layout-inspector" onClick={(event) => event.stopPropagation()}>
              <div className="layout-inspector-title">
                {isActive ? "ACTIVE" : "PANE"} · {node.id.slice(-6).toUpperCase()}
              </div>
              <div className="layout-inspector-grid">
                <span>state</span>
                <strong>{node.ptyId ? "connected" : discState ? "recovering" : "idle"}</strong>
                <span>source</span>
                <strong>{identityMode}</strong>
                <span>target</span>
                <strong>
                  {node.tmuxIdentity
                    ? `${node.tmuxIdentity.sessionName}:${node.tmuxIdentity.windowIndex}.${node.tmuxIdentity.paneIndex}`
                    : "identity unknown"}
                </strong>
                <span>tmux layout</span>
                <strong title={node.tmuxIdentity?.windowLayout || "unknown"}>
                  {node.tmuxIdentity?.windowLayout || "unknown"}
                </strong>
                <span>title</span>
                <strong>{node.tmuxIdentity?.paneTitle || "none"}</strong>
                <span>process</span>
                <strong>{node.tmuxIdentity?.paneCurrentCommand || "unknown"}</strong>
              </div>
              {parsedTmuxLayout && (
                <div className="tmux-layout-preview" aria-label="tmux layout preview">
                  {renderTmuxLayoutPreview(parsedTmuxLayout, activeLayoutPaneId)}
                </div>
              )}
            </div>
          )}

          {discState && onRetryPane && onClosePane && (
            <RecoveryOverlay
              countdown={discState.countdown}
              bannerMessage={discState.bannerMessage}
              onRetry={() => onRetryPane(node.id)}
              onClose={() => onClosePane(node.id)}
            />
          )}
        </div>
      );
    }

    const isRow = node.type === "row";
    return (
      <div
        key={node.id}
        style={{
          display: shouldHide ? "none" : "flex",
          flexDirection: isRow ? "column" : "row",
          flex: 1,
          width: "100%",
          height: "100%",
          gap: shouldHide ? "0" : "4px",
          minWidth: 0,
          minHeight: 0,
        }}
      >
        {node.children.map((child) => renderNode(child))}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flex: 1, width: "100%", height: "100%", minWidth: 0, minHeight: 0 }}>
      {renderNode(layout)}
    </div>
  );
};
