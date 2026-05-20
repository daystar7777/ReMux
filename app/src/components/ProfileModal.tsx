import React, { useState, useEffect } from "react";
import { X } from "lucide-react";
import type { Host, Profile } from "../types/config";
import { newProfileId, validateProfile } from "../types/config";

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

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ width: "420px", maxWidth: "90vw" }}>
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
            <label className="form-label">Target Host *</label>
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

          <div className="form-row">
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
          </div>

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
