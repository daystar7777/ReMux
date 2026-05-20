import { X, Download } from "lucide-react";

interface MissingTmuxModalProps {
  onInstallLocal: () => void;
  onClose: () => void;
}

export function MissingTmuxModal({
  onInstallLocal,
  onClose,
}: MissingTmuxModalProps) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "420px", maxWidth: "90vw" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: "var(--warn)" }}>Tmux is Missing</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close modal">
            <X size={16} />
          </button>
        </div>

        <p style={{ margin: "0 0 16px 0", fontSize: 13, color: "var(--fg-1)", lineHeight: 1.5 }}>
          It looks like <strong>tmux</strong> is not installed on your local machine. 
          REMUX requires tmux to manage persistent terminal sessions.
        </p>

        <div className="actions" style={{ flexDirection: "column", gap: 8, alignItems: "stretch" }}>
          <button
            className="primary"
            onClick={onInstallLocal}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px" }}
          >
            <Download size={14} />
            <span>Install tmux via Homebrew</span>
          </button>
          <button onClick={onClose} style={{ padding: "10px", marginTop: 4 }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
