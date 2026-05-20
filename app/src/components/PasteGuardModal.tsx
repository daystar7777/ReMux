interface Props {
  text: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function PasteGuardModal({ text, onConfirm, onCancel }: Props) {
  const lines = text.split(/\r?\n/);
  const previewText = lines.slice(0, 12).join("\n") + (lines.length > 12 ? `\n… (+${lines.length - 12} more)` : "");
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h3>Paste {lines.length} lines?</h3>
        <div className="preview">{previewText || "(empty)"}</div>
        <div className="actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={onConfirm} autoFocus>
            Paste (bracketed)
          </button>
        </div>
      </div>
    </div>
  );
}
