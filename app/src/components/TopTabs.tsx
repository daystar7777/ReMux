import { useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { SquarePlus, X, Sliders } from "lucide-react";
import {
  activeTabIdAtom,
  closeTabAction,
  openTabsAtom,
  profilesAtom,
  hostsAtom,
  rightPanelOpenAtom,
  updateProfileAction,
} from "../state/atoms";
import { openNewWindow } from "../lib/ipc";

interface TopTabsProps {
  onRenameWindowDirect?: (target: string, nextName: string) => Promise<void>;
}

export function TopTabs({ onRenameWindowDirect }: TopTabsProps) {
  const tabs = useAtomValue(openTabsAtom);
  const activeId = useAtomValue(activeTabIdAtom);
  const profiles = useAtomValue(profilesAtom);
  const hosts = useAtomValue(hostsAtom);
  const setActive = useSetAtom(activeTabIdAtom);
  const closeTab = useSetAtom(closeTabAction);
  const [panelOpen, setPanelOpen] = useAtom(rightPanelOpenAtom);
  const updateProfile = useSetAtom(updateProfileAction);

  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  const handleSaveRename = async (tabId: string, profile: any) => {
    setEditingTabId(null);
    const newName = editingText.trim();
    if (!profile || !newName || newName === profile.display_alias) return;

    await updateProfile({
      ...profile,
      display_alias: newName,
    });

    const tab = tabs.find((t) => t.id === tabId);
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
        const profile = profiles.find((p) => p.id === tab.profileId);
        const host = profile ? hosts.find((h) => h.id === profile.host_id) : undefined;
        const isEditing = tab.id === editingTabId;
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

