interface Props {
  host: string;
  fingerprintBlock: string;
  onAccept: () => void;
  onReject: () => void;
}

export function FingerprintModal({ host, fingerprintBlock, onAccept, onReject }: Props) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h3>New SSH host key — {host}</h3>
        <p style={{ margin: "0 0 4px", color: "var(--fg-1)" }}>
          The host&apos;s public key was not recognized. Confirm the fingerprint matches what you expect before continuing.
        </p>
        <div className="preview">{fingerprintBlock}</div>
        <div className="actions">
          <button className="danger" onClick={onReject}>
            Reject
          </button>
          <button className="primary" onClick={onAccept} autoFocus>
            Accept &amp; trust
          </button>
        </div>
      </div>
    </div>
  );
}
