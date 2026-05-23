import { useState, useEffect, useRef } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { ChevronsLeft, Plus, Server, Edit, Trash2, MoreVertical, PlusCircle } from "lucide-react";
import {
  hostsAtom,
  openTabAction,
  profilesAtom,
  sidebarCollapsedAtom,
  activeTabAtom,
  addHostAction,
  updateHostAction,
  deleteHostAction,
  addProfileAction,
  updateProfileAction,
  deleteProfileAction,
} from "../state/atoms";
import { HostModal } from "./HostModal";
import { ProfileModal } from "./ProfileModal";
import type { Host, Profile } from "../types/config";

export function Sidebar() {
  const [collapsed, setCollapsed] = useAtom(sidebarCollapsedAtom);
  const profiles = useAtomValue(profilesAtom);
  const hosts = useAtomValue(hostsAtom);
  const openTab = useSetAtom(openTabAction);
  const activeTab = useAtomValue(activeTabAtom);

  // Jotai CRUD Actions
  const addHost = useSetAtom(addHostAction);
  const updateHost = useSetAtom(updateHostAction);
  const deleteHost = useSetAtom(deleteHostAction);
  const addProfile = useSetAtom(addProfileAction);
  const updateProfile = useSetAtom(updateProfileAction);
  const deleteProfile = useSetAtom(deleteProfileAction);

  // Modal States
  const [hostModalOpen, setHostModalOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [editingHost, setEditingHost] = useState<Host | undefined>(undefined);
  const [editingProfile, setEditingProfile] = useState<Profile | undefined>(undefined);

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
          return (
            <div key={host.id} style={{ marginBottom: 12 }}>
              <div
                className="group-label"
                title={`${host.address}:${host.port || ""}`}
                onContextMenu={(e) => handleContextMenu(e, "host", host.id)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingRight: 6,
                  cursor: "context-menu",
                }}
              >
                <span>{host.label}</span>
                {!collapsed && (
                  <div style={{ display: "flex", gap: 2 }}>
                    <button
                      className="icon-btn"
                      style={{ width: 16, height: 16, border: "none" }}
                      onClick={() => {
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
                      onClick={(e) => handleContextMenu(e, "host", host.id)}
                    >
                      <MoreVertical size={10} />
                    </button>
                  </div>
                )}
              </div>
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
