import { useState, useEffect, useRef } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { ChevronDown, ChevronRight, ChevronsLeft, Layers, Plus, RefreshCw, Server, Edit, Trash2, MoreVertical, PlusCircle } from "lucide-react";
import {
  hostsAtom,
  openTabAction,
  openEphemeralTabAction,
  profilesAtom,
  sidebarCollapsedAtom,
  activeTabAtom,
  addHostAction,
  addProfileAction,
  updateHostAction,
  deleteHostAction,
  updateProfileAction,
  deleteProfileAction,
} from "../state/atoms";
import { HostModal } from "./HostModal";
import { ProfileModal } from "./ProfileModal";
import { tmuxProbeHierarchy, type TmuxSessionNode } from "../lib/ipc";
import type { Host, Profile } from "../types/config";
import { newProfileId } from "../types/config";

export function Sidebar() {
  const [collapsed, setCollapsed] = useAtom(sidebarCollapsedAtom);
  const profiles = useAtomValue(profilesAtom);
  const hosts = useAtomValue(hostsAtom);
  const openTab = useSetAtom(openTabAction);
  const openEphemeralTab = useSetAtom(openEphemeralTabAction);
  const activeTab = useAtomValue(activeTabAtom);

  // Jotai CRUD Actions
  const addHost = useSetAtom(addHostAction);
  const addProfile = useSetAtom(addProfileAction);
  const updateHost = useSetAtom(updateHostAction);
  const deleteHost = useSetAtom(deleteHostAction);
  const updateProfile = useSetAtom(updateProfileAction);
  const deleteProfile = useSetAtom(deleteProfileAction);

  // Modal States
  const [hostModalOpen, setHostModalOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [editingHost, setEditingHost] = useState<Host | undefined>(undefined);
  const [editingProfile, setEditingProfile] = useState<Profile | undefined>(undefined);
  const [expandedHosts, setExpandedHosts] = useState<Record<string, boolean>>({});
  const [hostTmuxTree, setHostTmuxTree] = useState<Record<string, TmuxSessionNode[]>>({});
  const [hostProbeState, setHostProbeState] = useState<Record<string, "idle" | "loading" | "error">>({});

  // Delete Confirm State
  const [deleteConfirm, setDeleteConfirm] = useState<{
    type: "host" | "profile";
    id: string;
    label: string;
  } | null>(null);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: "host" | "profile";
    id: string;
  } | null>(null);

  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Close context menu on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  if (collapsed) {
    return null;
  }

  const handleContextMenu = (e: React.MouseEvent, type: "host" | "profile", id: string) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      type,
      id,
    });
  };

  const handleEdit = () => {
    if (!contextMenu) return;
    const { type, id } = contextMenu;
    setContextMenu(null);

    if (type === "host") {
      const h = hosts.find((x) => x.id === id);
      if (h) {
        setEditingHost(h);
        setHostModalOpen(true);
      }
    } else {
      const p = profiles.find((x) => x.id === id);
      if (p) {
        setEditingProfile(p);
        setProfileModalOpen(true);
      }
    }
  };

  const handleDeleteTrigger = () => {
    if (!contextMenu) return;
    const { type, id } = contextMenu;
    setContextMenu(null);

    if (type === "host") {
      const h = hosts.find((x) => x.id === id);
      if (h) {
        setDeleteConfirm({
          type: "host",
          id,
          label: h.label,
        });
      }
    } else {
      const p = profiles.find((x) => x.id === id);
      if (p) {
        setDeleteConfirm({
          type: "profile",
          id,
          label: p.display_alias,
        });
      }
    }
  };

  const executeDelete = async () => {
    if (!deleteConfirm) return;
    const { type, id } = deleteConfirm;
    setDeleteConfirm(null);

    if (type === "host") {
      await deleteHost(id);
    } else {
      await deleteProfile(id);
    }
  };

  const probeHostTmux = async (host: Host) => {
    if (hostProbeState[host.id] === "loading") return;
    setHostProbeState((prev) => ({ ...prev, [host.id]: "loading" }));
    try {
      const tree = await tmuxProbeHierarchy({
        host: host.auth_method === "local" ? undefined : host.address,
        user: host.username || undefined,
        port: host.port || undefined,
        sshConfigAlias: host.ssh_config_alias,
        keyPath: host.key_path,
        proxyJump: host.proxy_jump,
        identityAgent: host.identity_agent,
        tmuxBinary: host.custom_tmux_binary,
        socketPath: host.tmux_socket_path,
        skipHostKeyCheck: host.skip_host_key_check,
      });
      setHostTmuxTree((prev) => ({ ...prev, [host.id]: tree }));
      setHostProbeState((prev) => ({ ...prev, [host.id]: "idle" }));
    } catch (e) {
      console.warn("Host tmux probe failed", e);
      setHostTmuxTree((prev) => ({ ...prev, [host.id]: [] }));
      setHostProbeState((prev) => ({ ...prev, [host.id]: "error" }));
    }
  };

  const toggleHost = (host: Host) => {
    const nextExpanded = !expandedHosts[host.id];
    setExpandedHosts((prev) => ({ ...prev, [host.id]: nextExpanded }));
    // Auto-probe only local hosts on expand. Expanding a remote host must not
    // silently open an SSH connection just to look — remote hosts load their live
    // tmux list on explicit refresh.
    if (nextExpanded && !hostTmuxTree[host.id] && host.auth_method === "local") {
      void probeHostTmux(host);
    }
  };

  const openDiscoveredTarget = async (
    host: Host,
    sessionName: string,
    windowTarget?: string,
    windowLabel?: string,
    windowName?: string,
  ) => {
    const existing = profiles.find(
      (p) =>
        p.host_id === host.id &&
        p.tmux_session_name === sessionName &&
        ((p.tmux_window_target || "") === (windowTarget || "") ||
          (windowName ? p.tmux_window_target === windowName : false)),
    );
    if (existing) {
      openTab(existing.id);
      return;
    }

    const profile: Profile = {
      id: newProfileId(),
      host_id: host.id,
      tmux_session_name: sessionName,
      tmux_window_target: windowTarget || "",
      display_alias: windowTarget
        ? `${host.label} · ${sessionName}:${windowLabel || windowTarget}`
        : `${host.label} · ${sessionName}`,
    };
    openEphemeralTab(profile);
  };

  const grouped = new Map<string, typeof profiles>();
  for (const p of profiles) {
    const list = grouped.get(p.host_id) ?? [];
    list.push(p);
    grouped.set(p.host_id, list);
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span>Connections</span>
        <button
          className="icon-btn"
          aria-label="Collapse sidebar"
          onClick={() => setCollapsed(true)}
        >
          <ChevronsLeft size={14} />
        </button>
      </div>

      <div className="sidebar-tree">
        {!collapsed && (
          <div style={{ display: "flex", gap: 6, padding: "4px 8px 10px 8px" }}>
            <button
              className="icon-btn"
              style={{ flex: 1, height: 28, fontSize: 11, gap: 4, display: "flex", alignItems: "center" }}
              onClick={() => {
                setEditingHost(undefined);
                setHostModalOpen(true);
              }}
              title="Add Host"
            >
              <PlusCircle size={12} />
              <span>Host</span>
            </button>
            <button
              className="icon-btn"
              style={{ flex: 1, height: 28, fontSize: 11, gap: 4, display: "flex", alignItems: "center" }}
              onClick={() => {
                setEditingProfile(undefined);
                setProfileModalOpen(true);
              }}
              disabled={hosts.length === 0}
              title="Add Profile"
            >
              <PlusCircle size={12} />
              <span>Profile</span>
            </button>
          </div>
        )}

        {hosts.map((host) => {
          const hostProfiles = grouped.get(host.id) ?? [];
          const isExpanded = !!expandedHosts[host.id];
          const liveSessions = hostTmuxTree[host.id] ?? [];
          const probeState = hostProbeState[host.id] ?? "idle";
          return (
            <div key={host.id} style={{ marginBottom: 12 }}>
              <div
                className="group-label"
                title={`${host.address}:${host.port || ""}`}
                onContextMenu={(e) => handleContextMenu(e, "host", host.id)}
                onClick={() => toggleHost(host)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingRight: 6,
                  cursor: "pointer",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                  {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {host.label}
                  </span>
                </span>
                {!collapsed && (
                  <div style={{ display: "flex", gap: 2 }}>
                    <button
                      className="icon-btn"
                      style={{ width: 16, height: 16, border: "none" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        void probeHostTmux(host);
                        setExpandedHosts((prev) => ({ ...prev, [host.id]: true }));
                      }}
                      title="Refresh tmux screens"
                    >
                      <RefreshCw size={10} className={probeState === "loading" ? "spin" : ""} />
                    </button>
                    <button
                      className="icon-btn"
                      style={{ width: 16, height: 16, border: "none" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingProfile(undefined);
                        setEditingHost(host);
                        setProfileModalOpen(true);
                      }}
                      title="Add Profile to this Host"
                    >
                      <Plus size={10} />
                    </button>
                    <button
                      className="icon-btn"
                      style={{ width: 16, height: 16, border: "none" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleContextMenu(e, "host", host.id);
                      }}
                    >
                      <MoreVertical size={10} />
                    </button>
                  </div>
                )}
              </div>
              {isExpanded && liveSessions.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 2, margin: "2px 0 4px 10px" }}>
                  {liveSessions.map((session) => (
                    <div key={session.sessionId}>
                      <div
                        className="profile"
                        title={`Attach ${host.label} · ${session.sessionName}`}
                        onClick={() => void openDiscoveredTarget(host, session.sessionName)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          cursor: "pointer",
                          paddingRight: 8,
                        }}
                      >
                        <Server size={12} style={{ flexShrink: 0 }} />
                        <span className="alias">{session.sessionName}</span>
                        <span className="target" style={{ marginLeft: "auto" }}>
                          live
                        </span>
                      </div>
                      {session.windows.map((w) => (
                        <div
                          key={w.windowId}
                          className="profile"
                          title={`Attach ${host.label} · ${session.sessionName}:${w.windowName}`}
                          onClick={() =>
                            void openDiscoveredTarget(
                              host,
                              session.sessionName,
                              w.windowId || String(w.windowIndex),
                              `${w.windowIndex}: ${w.windowName}`,
                              w.windowName,
                            )
                          }
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            cursor: "pointer",
                            padding: "4px 8px 4px 28px",
                          }}
                        >
                          <Layers size={11} style={{ flexShrink: 0 }} />
                          <span className="alias">
                            {w.windowIndex}: {w.windowName}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              {isExpanded && probeState === "error" && (
                <div style={{ padding: "4px 10px 6px 22px", fontSize: 10, color: "var(--warn)" }}>
                  tmux screens unavailable
                </div>
              )}
              {isExpanded && liveSessions.length === 0 && probeState === "idle" && hostTmuxTree[host.id] && (
                <div style={{ padding: "4px 10px 6px 22px", fontSize: 10, color: "var(--fg-3)" }}>
                  no live tmux screens
                </div>
              )}
              {isExpanded &&
                host.auth_method !== "local" &&
                !hostTmuxTree[host.id] &&
                probeState !== "loading" && (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => void probeHostTmux(host)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      void probeHostTmux(host);
                    }}
                    title="Connect over SSH and load live tmux screens"
                    style={{
                      padding: "4px 10px 6px 22px",
                      fontSize: 10,
                      color: "var(--accent)",
                      cursor: "pointer",
                    }}
                  >
                    Refresh to load live tmux screens
                  </div>
                )}
              {hostProfiles.map((p) => {
                const isActive = activeTab?.profileId === p.id;
                return (
                  <div
                    key={p.id}
                    className={`profile${isActive ? " active" : ""}`}
                    onClick={() => openTab(p.id)}
                    onContextMenu={(e) => handleContextMenu(e, "profile", p.id)}
                    title={`${host.label} · ${p.tmux_session_name}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      cursor: "pointer",
                      paddingRight: 8,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                      <Server size={12} style={{ flexShrink: 0 }} />
                      <span className="alias">{p.display_alias}</span>
                    </div>
                    {!collapsed && (
                      <span className="target" style={{ flexShrink: 0 }}>
                        {p.tmux_session_name}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Context Menu Overlay */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            background: "var(--bg-2)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
            zIndex: 2000,
            padding: "4px",
            display: "flex",
            flexDirection: "column",
            minWidth: "100px",
          }}
        >
          <button
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              border: "none",
              background: "transparent",
              width: "100%",
              textAlign: "left",
              padding: "6px 10px",
              fontSize: 12,
              borderRadius: "4px",
              cursor: "pointer",
            }}
            onClick={handleEdit}
            className="profile"
          >
            <Edit size={12} />
            <span>Edit</span>
          </button>
          <button
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              border: "none",
              background: "transparent",
              width: "100%",
              textAlign: "left",
              padding: "6px 10px",
              fontSize: 12,
              borderRadius: "4px",
              cursor: "pointer",
              color: "var(--danger)",
            }}
            onClick={handleDeleteTrigger}
            className="profile"
          >
            <Trash2 size={12} />
            <span>Delete</span>
          </button>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="modal-backdrop">
          <div className="modal" style={{ width: "350px" }}>
            <h3 style={{ margin: "0 0 12px 0", color: "var(--danger)" }}>Delete Confirmation</h3>
            <p style={{ margin: "0 0 16px 0", fontSize: 13, color: "var(--fg-1)" }}>
              Are you sure you want to delete {deleteConfirm.type} <strong>{deleteConfirm.label}</strong>?
              {deleteConfirm.type === "host" && " This will also delete all connection profiles belonging to this host."}
            </p>
            <div className="actions">
              <button onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="danger" onClick={executeDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Host Modal */}
      {hostModalOpen && (
        <HostModal
          host={editingHost}
          onClose={() => setHostModalOpen(false)}
          onSave={async (payload) => {
            if (editingHost) {
              await updateHost(payload);
            } else {
              await addHost(payload);
            }
          }}
        />
      )}

      {/* Profile Modal */}
      {profileModalOpen && (
        <ProfileModal
          profile={editingProfile}
          hosts={hosts}
          defaultHostId={editingHost?.id}
          onClose={() => {
            setProfileModalOpen(false);
            setEditingHost(undefined);
            setEditingProfile(undefined);
          }}
          onSave={async (savedProfile) => {
            if (editingProfile) {
              await updateProfile(savedProfile);
            } else {
              await addProfile(savedProfile);
            }
          }}
        />
      )}
    </aside>
  );
}
