import React, { useState, useEffect } from "react";
import { X } from "lucide-react";
import type { Host, Profile } from "../types/config";
import { newProfileId, validateProfile } from "../types/config";
import { tmuxProbeHierarchy, probeRemoteEnv, tmuxLocalVersion, type TmuxSessionNode } from "../lib/ipc";

interface ProfileModalProps {
  profile?: Profile; // If provided, edit mode
  hosts: Host[];
  onClose: () => void;
  onSave: (profile: Profile) => void;
}

export function ProfileModal({ profile, hosts, onClose, onSave }: ProfileModalProps) {
  const [displayAlias, setDisplayAlias] = useState("");
  const [hostId, setHostId] = useState("");
  const [tmuxSessionName, setTmuxSessionName] = useState("remux-dev");
  const [tmuxWindowTarget, setTmuxWindowTarget] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Tmux probing states
  const [probing, setProbing] = useState(false);
  const [sessions, setSessions] = useState<TmuxSessionNode[]>([]);
  const [isTmuxMissing, setIsTmuxMissing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);

  const [useCustomSession, setUseCustomSession] = useState(true);
  const [useCustomWindow, setUseCustomWindow] = useState(true);

  useEffect(() => {
    if (profile) {
      setDisplayAlias(profile.display_alias || "");
      setHostId(profile.host_id || "");
      setTmuxSessionName(profile.tmux_session_name || "remux-dev");
      setTmuxWindowTarget(profile.tmux_window_target || "");
    } else if (hosts.length > 0) {
      // Default to first host
      setHostId(hosts[0].id);
    }
  }, [profile, hosts]);

  const probeHost = async (host: Host) => {
    setProbing(true);
    setProbeError(null);
    setIsTmuxMissing(false);
    setSessions([]);

    try {
      if (host.auth_method === "local") {
        const localVersion = await tmuxLocalVersion(host.custom_tmux_binary || undefined);
        if (!localVersion) {
          setIsTmuxMissing(true);
          setProbing(false);
          return;
        }
        const data = await tmuxProbeHierarchy({
          tmuxBinary: host.custom_tmux_binary || undefined,
          socketPath: host.tmux_socket_path || undefined,
        });
        setSessions(data);
      } else {
        // Remote host
        try {
          const env = await probeRemoteEnv({
            host: host.address,
            user: host.username || undefined,
            port: host.port || undefined,
            sshConfigAlias: host.ssh_config_alias || undefined,
            keyPath: host.key_path || undefined,
            proxyJump: host.proxy_jump || undefined,
            identityAgent: host.identity_agent || undefined,
          });
          if (!env.tmuxPresent) {
            setIsTmuxMissing(true);
            setProbing(false);
            return;
          }
        } catch (e) {
          console.warn("probeRemoteEnv failed", e);
        }

        const data = await tmuxProbeHierarchy({
          host: host.address,
          user: host.username || undefined,
          port: host.port || undefined,
          sshConfigAlias: host.ssh_config_alias || undefined,
          keyPath: host.key_path || undefined,
          proxyJump: host.proxy_jump || undefined,
          identityAgent: host.identity_agent || undefined,
          tmuxBinary: host.custom_tmux_binary || undefined,
          socketPath: host.tmux_socket_path || undefined,
        });
        setSessions(data);
      }
    } catch (err: any) {
      console.error("Probing failed", err);
      const errMsg = err?.toString() || "Unknown error";
      if (errMsg.toLowerCase().includes("not found") || errMsg.toLowerCase().includes("tmux_missing")) {
        setIsTmuxMissing(true);
      } else {
        setProbeError(errMsg);
      }
    } finally {
      setProbing(false);
    }
  };

  useEffect(() => {
    if (!hostId) return;
    const selectedHost = hosts.find((h) => h.id === hostId);
    if (selectedHost) {
      probeHost(selectedHost);
    }
  }, [hostId, hosts]);

  useEffect(() => {
    if (sessions.length > 0) {
      if (profile && profile.tmux_session_name) {
        const foundSession = sessions.find((s) => s.sessionName === profile.tmux_session_name);
        if (foundSession) {
          setUseCustomSession(false);
          setTmuxSessionName(profile.tmux_session_name);

          if (profile.tmux_window_target) {
            const foundWindow = foundSession.windows.find((w) => w.windowName === profile.tmux_window_target);
            if (foundWindow) {
              setUseCustomWindow(false);
              setTmuxWindowTarget(profile.tmux_window_target);
            } else {
              setUseCustomWindow(true);
              setTmuxWindowTarget(profile.tmux_window_target);
            }
          } else {
            setUseCustomWindow(false);
            setTmuxWindowTarget("");
          }
        } else {
          setUseCustomSession(true);
          setTmuxSessionName(profile.tmux_session_name);
          setUseCustomWindow(true);
          setTmuxWindowTarget(profile.tmux_window_target || "");
        }
      } else {
        setUseCustomSession(false);
        setTmuxSessionName(sessions[0].sessionName);
        setUseCustomWindow(false);
        setTmuxWindowTarget("");
      }
    } else {
      setUseCustomSession(true);
      setUseCustomWindow(true);
    }
  }, [sessions, profile]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
    const validationError = validateProfile({
      display_alias: displayAlias.trim(),
      host_id: hostId,
      tmux_session_name: tmuxSessionName.trim(),
    });
    if (validationError) {
      setError(validationError);
      return;
    }

    const savedProfile: Profile = {
      id: profile?.id || newProfileId(),
      display_alias: displayAlias.trim(),
      host_id: hostId,
      tmux_session_name: tmuxSessionName.trim(),
      tmux_window_target: tmuxWindowTarget.trim() || undefined,
    };

    onSave(savedProfile);
  };

  const selectedHost = hosts.find((h) => h.id === hostId);
  const selectedSessionObj = sessions.find((s) => s.sessionName === tmuxSessionName);

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ width: "450px", maxWidth: "95vw" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>{profile ? "Edit Profile" : "New Profile"}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close modal">
            <X size={16} />
          </button>
        </div>

        {error && (
          <div className="banner danger" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="form-group">
            <label className="form-label">Profile Display Name *</label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g. Server Logs or Dev Session"
              value={displayAlias}
              onChange={(e) => setDisplayAlias(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Target Host *</span>
              {selectedHost && (
                <button
                  type="button"
                  onClick={() => probeHost(selectedHost)}
                  disabled={probing}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--accent)",
                    fontSize: "11px",
                    cursor: "pointer",
                    padding: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <span>{probing ? "Probing..." : "🔄 Refresh Sessions"}</span>
                </button>
              )}
            </label>
            <select
              className="form-select"
              value={hostId}
              onChange={(e) => setHostId(e.target.value)}
              required
            >
              <option value="" disabled>Select a host...</option>
              {hosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label} ({h.auth_method === "local" ? "localhost" : h.address})
                </option>
              ))}
            </select>
          </div>

          {/* Probing Banners */}
          {probing && (
            <div className="banner" style={{ margin: "2px 0 6px 0", background: "rgba(106, 169, 255, 0.08)", borderColor: "rgba(106, 169, 255, 0.25)", color: "var(--accent)" }}>
              <span>🔍 Probing host for active tmux sessions...</span>
            </div>
          )}

          {isTmuxMissing && (
            <div className="banner danger" style={{ margin: "2px 0 6px 0" }}>
              <span>⚠️ Tmux is not installed on this host! Please install tmux on the host server before connecting.</span>
            </div>
          )}

          {probeError && !isTmuxMissing && (
            <div className="banner" style={{ margin: "2px 0 6px 0", background: "rgba(245, 176, 74, 0.08)", borderColor: "rgba(245, 176, 74, 0.25)", color: "var(--warn)" }}>
              <span>ℹ️ Could not probe active sessions: {probeError}. (You can still type details manually)</span>
            </div>
          )}

          {!probing && !isTmuxMissing && !probeError && hostId && sessions.length === 0 && (
            <div className="banner" style={{ margin: "2px 0 6px 0", background: "rgba(106, 169, 255, 0.05)", borderColor: "rgba(106, 169, 255, 0.15)", color: "var(--fg-1)" }}>
              <span>ℹ️ No active tmux sessions found. Enter session details below to spawn a new session.</span>
            </div>
          )}

          {/* Tmux Session Name Selector */}
          {sessions.length > 0 ? (
            <div className="form-group">
              <label className="form-label">Tmux Session Name *</label>
              <div style={{ display: "flex", gap: 8 }}>
                <select
                  className="form-select"
                  value={useCustomSession ? "__custom__" : tmuxSessionName}
                  onChange={(e) => {
                    if (e.target.value === "__custom__") {
                      setUseCustomSession(true);
                      setTmuxSessionName("");
                      setUseCustomWindow(true);
                      setTmuxWindowTarget("");
                    } else {
                      setUseCustomSession(false);
                      setTmuxSessionName(e.target.value);
                      
                      const sessObj = sessions.find((s) => s.sessionName === e.target.value);
                      if (sessObj && sessObj.windows.length > 0) {
                        setUseCustomWindow(false);
                        setTmuxWindowTarget("");
                      } else {
                        setUseCustomWindow(true);
                        setTmuxWindowTarget("");
                      }
                    }
                  }}
                  style={{ flex: 1 }}
                >
                  <option value="" disabled>Select active session...</option>
                  {sessions.map((s) => (
                    <option key={s.sessionId} value={s.sessionName}>
                      {s.sessionName} ({s.windows.length} windows)
                    </option>
                  ))}
                  <option value="__custom__">+ Create a new session...</option>
                </select>

                {useCustomSession && (
                  <input
                    type="text"
                    className="form-input"
                    placeholder="New session name..."
                    value={tmuxSessionName}
                    onChange={(e) => setTmuxSessionName(e.target.value)}
                    required
                    style={{ flex: 1 }}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="form-group">
              <label className="form-label">Tmux Session Name *</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. remux-dev"
                value={tmuxSessionName}
                onChange={(e) => setTmuxSessionName(e.target.value)}
                required
              />
            </div>
          )}

          {/* Initial Window Target Selector */}
          {!useCustomSession && selectedSessionObj ? (
            <div className="form-group">
              <label className="form-label">Initial Window (Optional)</label>
              <div style={{ display: "flex", gap: 8 }}>
                <select
                  className="form-select"
                  value={useCustomWindow ? "__custom__" : tmuxWindowTarget}
                  onChange={(e) => {
                    if (e.target.value === "__custom__") {
                      setUseCustomWindow(true);
                      setTmuxWindowTarget("");
                    } else {
                      setUseCustomWindow(false);
                      setTmuxWindowTarget(e.target.value);
                    }
                  }}
                  style={{ flex: 1 }}
                >
                  <option value="">[First Window / Default]</option>
                  {selectedSessionObj.windows.map((w) => (
                    <option key={w.windowId} value={w.windowIndex.toString()}>
                      {w.windowIndex}: {w.windowName}
                    </option>
                  ))}
                  <option value="__custom__">+ Custom window target...</option>
                </select>

                {useCustomWindow && (
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Custom window target..."
                    value={tmuxWindowTarget}
                    onChange={(e) => setTmuxWindowTarget(e.target.value)}
                    style={{ flex: 1 }}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="form-group">
              <label className="form-label">Initial Window (Optional)</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. monitoring"
                value={tmuxWindowTarget}
                onChange={(e) => setTmuxWindowTarget(e.target.value)}
              />
            </div>
          )}

          <div className="actions" style={{ marginTop: 12 }}>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary">
              Save Profile
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
