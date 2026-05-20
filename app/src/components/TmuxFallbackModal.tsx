interface Props {
  sessionName: string;
  exitCode: number | null;
  onReattach: () => void;
  onRawShell: () => void;
  onClose: () => void;
}

export function TmuxFallbackModal({
  sessionName,
  exitCode,
  onReattach,
  onRawShell,
  onClose,
}: Props) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h3>tmux session ended</h3>
        <p style={{ margin: "0 0 4px", color: "var(--fg-1)" }}>
          Session <strong>{sessionName}</strong> exited (code {exitCode ?? "?"}). Pick how to continue.
        </p>
        <div className="actions" style={{ justifyContent: "space-between" }}>
          <button onClick={onClose} className="danger">
            Close tab
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onRawShell}>Open raw shell</button>
            <button className="primary" onClick={onReattach} autoFocus>
              Reattach (new tmux)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
