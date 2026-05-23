interface Props {
  keyPath: string;
  onFix: () => void;
  onSkip: () => void;
  onCancel: () => void;
}

export function KeyPermissionsModal({ keyPath, onFix, onSkip, onCancel }: Props) {
  const fileName = keyPath.split(/[/\\]/).pop() || keyPath;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal" style={{ maxWidth: "480px" }}>
        <h3>Unprotected Private Key File</h3>
        <p style={{ margin: "0 0 12px", color: "var(--fg-1)", lineHeight: "1.5", fontSize: "13px" }}>
          Your private key file <strong>{fileName}</strong> has unsafe permissions (it is currently accessible by others).
          SSH requires private key files to be protected (read/write by owner only) and will reject connections otherwise.
        </p>
        <div style={{
          margin: "0 0 16px",
          padding: "8px 12px",
          background: "var(--bg-2)",
          borderRadius: "6px",
          fontSize: "11px",
          color: "var(--fg-dim)",
          wordBreak: "break-all",
          fontFamily: "monospace",
          border: "1px solid var(--border)"
        }}>
          Path: {keyPath}
        </div>
        <div className="actions" style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="secondary" onClick={onSkip}>
            Connect Anyway
          </button>
          <button className="primary" onClick={onFix} autoFocus>
            Fix Permissions &amp; Connect
          </button>
        </div>
      </div>
    </div>
  );
}
