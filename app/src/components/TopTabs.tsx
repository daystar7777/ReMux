import { useState, type MouseEvent as ReactMouseEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Pin, SquarePlus, X, Sliders, Server, Layers } from "lucide-react";
import {
  activeTabIdAtom,
  activateAgentPaneAction,
  closeTabAction,
  openTabsAtom,
  paneAgentStateAtom,
  profilesAtom,
  hostsAtom,
  rightPanelOpenAtom,
  updateProfileAction,
  sidebarCollapsedAtom,
  inventorySidebarCollapsedAtom,
  pinEphemeralTabAction,
  updateEphemeralProfileAction,
} from "../state/atoms";
import { openNewWindow } from "../lib/ipc";
import {
  agentStateLabel,
  agentStateTone,
  collectPaneIdsFromLayout,
  isNavigableAgentState,
  rollupAgentState,
} from "../lib/agentState";

interface TopTabsProps {
  onRenameWindowDirect?: (target: string, nextName: string) => Promise<void>;
}

export function TopTabs({ onRenameWindowDirect }: TopTabsProps) {
  const tabs = useAtomValue(openTabsAtom);
  const activeId = useAtomValue(activeTabIdAtom);
  const profiles = useAtomValue(profilesAtom);
  const hosts = useAtomValue(hostsAtom);
  const paneAgentStates = useAtomValue(paneAgentStateAtom);
  const setActive = useSetAtom(activeTabIdAtom);
  const activateAgentPane = useSetAtom(activateAgentPaneAction);
  const closeTab = useSetAtom(closeTabAction);
  const pinEphemeralTab = useSetAtom(pinEphemeralTabAction);
  const updateEphemeralProfile = useSetAtom(updateEphemeralProfileAction);
  const [panelOpen, setPanelOpen] = useAtom(rightPanelOpenAtom);
  const updateProfile = useSetAtom(updateProfileAction);
  const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom);
  const [inventoryCollapsed, setInventoryCollapsed] = useAtom(inventorySidebarCollapsedAtom);

  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  const handleSaveRename = async (tabId: string, profile: any) => {
    setEditingTabId(null);
    const newName = editingText.trim();
    if (!profile || !newName || newName === profile.display_alias) return;

    const tab = tabs.find((t) => t.id === tabId);
    if (tab?.ephemeralProfile) {
      updateEphemeralProfile({
        tabId,
        profile: {
          ...tab.ephemeralProfile,
          display_alias: newName,
        },
      });
      await pinEphemeralTab(tabId);
    } else {
      await updateProfile({
        ...profile,
        display_alias: newName,
      });
    }

    const findActivePaneIdentity = (node: any, activePaneId: string): any => {
      if (!node) return null;
      if (node.type === "leaf") {
        return node.id === activePaneId ? node.tmuxIdentity : null;
      }
      for (const child of node.children) {
        const found = findActivePaneIdentity(child, activePaneId);
        if (found) return found;
      }
      return null;
    };

    if (tab && tab.layout && tab.activePaneId) {
      const identity = findActivePaneIdentity(tab.layout, tab.activePaneId);
      if (identity) {
        const target = identity.windowId || `${identity.sessionName}:${identity.windowIndex}`;
        if (onRenameWindowDirect) {
          await onRenameWindowDirect(target, newName);
        }
      }
    }
  };

  return (
    <div className="top-tabs">
      {tabs.map((tab) => {
        const profile = profiles.find((p) => p.id === tab.profileId) ?? tab.ephemeralProfile;
        const host = profile ? hosts.find((h) => h.id === profile.host_id) : undefined;
        const isEphemeral = !!tab.ephemeralProfile;
        const isEditing = tab.id === editingTabId;
        const paneIds = collectPaneIdsFromLayout(tab.layout);
        const agentRollup = rollupAgentState(paneIds.map((paneId) => paneAgentStates[paneId]));
        const agentTone = agentStateTone(agentRollup);
        // Only blocked/done/working have a jump target (pickNavigableAgentPane
        // ignores idle/unknown). An idle rollup must render as a passive status
        // indicator, never as a "Jump to..." control that does nothing on click.
        const agentNavigable = isNavigableAgentState(agentRollup);
        const agentLabelText = agentStateLabel(agentRollup).toLowerCase();
        const cls = [
          "tab",
          tab.id === activeId ? "active" : "",
          tab.state === "connected" ? "connected" : "",
          tab.state === "warning" ? "warning" : "",
          tab.state === "error" ? "error" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            key={tab.id}
            className={cls}
            onClick={() => setActive(tab.id)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (profile) {
                setEditingTabId(tab.id);
                setEditingText(profile.display_alias);
              }
            }}
            title={
              host
                ? `${host.label} · ${profile?.tmux_session_name}`
                : profile?.display_alias
            }
          >
            <span className="state-dot" />
            {isEditing ? (
              <input
                className="tab-rename-input"
                autoFocus
                value={editingText}
                onChange={(e) => setEditingText(e.target.value)}
                onBlur={() => handleSaveRename(tab.id, profile)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleSaveRename(tab.id, profile);
                  } else if (e.key === "Escape") {
                    setEditingTabId(null);
                  }
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span>{profile?.display_alias ?? "unknown"}</span>
            )}
            {agentRollup !== "unknown" && (
              <span
                {...(agentNavigable
                  ? {
                      role: "button",
                      tabIndex: 0,
                      title: `Jump to ${agentLabelText} agent pane`,
                      "aria-label": `Jump to ${agentLabelText} agent pane`,
                      onClick: (e: ReactMouseEvent) => {
                        e.stopPropagation();
                        activateAgentPane({ tabId: tab.id });
                      },
                      onKeyDown: (e: ReactKeyboardEvent) => {
                        if (e.key !== "Enter" && e.key !== " ") return;
                        e.preventDefault();
                        e.stopPropagation();
                        activateAgentPane({ tabId: tab.id });
                      },
                    }
                  : {
                      title: `${agentLabelText} agent`,
                      "aria-label": `${agentLabelText} agent present`,
                    })}
                style={{
                  cursor: agentNavigable ? "pointer" : "default",
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                  color:
                    agentTone === "danger"
                      ? "var(--danger)"
                      : agentTone === "ok"
                        ? "var(--ok)"
                        : agentTone === "accent"
                          ? "var(--accent)"
                          : "var(--fg-3)",
                  fontSize: "9px",
                  fontWeight: 700,
                  padding: "1px 4px",
                  textTransform: "uppercase",
                }}
              >
                {agentRollup}
              </span>
            )}
            {isEphemeral && (
              <span
                className="icon-btn"
                role="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  void pinEphemeralTab(tab.id);
                }}
                title="Save profile"
                aria-label="Save profile"
              >
                <Pin size={11} />
              </span>
            )}
            <span
              className="icon-btn"
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              aria-label="Close tab"
            >
              <X size={12} />
            </span>
          </button>
        );
      })}
      <div className="spacer" />
      <button
        className="icon-btn"
        title="Toggle connections sidebar (Cmd+B)"
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        style={{
          color: !sidebarCollapsed ? "var(--accent)" : "var(--fg-1)",
          borderColor: !sidebarCollapsed ? "var(--accent-dim)" : "transparent",
          background: !sidebarCollapsed ? "rgba(106, 169, 255, 0.1)" : "transparent",
          marginRight: "6px",
        }}
        aria-label="Toggle connections sidebar"
      >
        <Server size={14} />
      </button>
      <button
        className="icon-btn"
        title="Toggle tmux inventory panel (Cmd+Shift+I)"
        onClick={() => setInventoryCollapsed(!inventoryCollapsed)}
        style={{
          color: !inventoryCollapsed ? "var(--accent)" : "var(--fg-1)",
          borderColor: !inventoryCollapsed ? "var(--accent-dim)" : "transparent",
          background: !inventoryCollapsed ? "rgba(106, 169, 255, 0.1)" : "transparent",
          marginRight: "6px",
        }}
        aria-label="Toggle tmux inventory panel"
      >
        <Layers size={14} />
      </button>
      <button
        className="icon-btn"
        title="Toggle appearance settings drawer"
        onClick={() => setPanelOpen(!panelOpen)}
        style={{
          color: panelOpen ? "var(--accent)" : "var(--fg-1)",
          borderColor: panelOpen ? "var(--accent-dim)" : "transparent",
          background: panelOpen ? "rgba(106, 169, 255, 0.1)" : "transparent",
          marginRight: "6px",
        }}
        aria-label="Toggle settings"
      >
        <Sliders size={14} />
      </button>
      <button
        className="icon-btn"
        title="Open new REMUX window"
        onClick={() => void openNewWindow()}
        aria-label="Open new window"
      >
        <SquarePlus size={14} />
      </button>
    </div>
  );
}
