import { useEffect, useRef, useState } from "react";

interface RenameWindowModalProps {
  currentName: string;
  identityLabel: string;
  title?: string;
  fieldLabel?: string;
  submitLabel?: string;
  allowEmpty?: boolean;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function RenameWindowModal({
  currentName,
  identityLabel,
  title = "Rename tmux window",
  fieldLabel = "Window name",
  submitLabel = "Rename",
  allowEmpty = false,
  onConfirm,
  onCancel,
}: RenameWindowModalProps) {
  const [name, setName] = useState(currentName);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const trimmed = name.trim();
  const canSubmit = (allowEmpty || trimmed.length > 0) && trimmed !== currentName;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-window-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) onConfirm(trimmed);
        }}
      >
        <h3 id="rename-window-title">{title}</h3>
        <p className="modal-subtle">{identityLabel}</p>
        <div className="form-group">
          <label className="form-label" htmlFor="rename-window-input">
            {fieldLabel}
          </label>
          <input
            ref={inputRef}
            id="rename-window-input"
            className="form-input"
            value={name}
            spellCheck={false}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onCancel();
            }}
          />
        </div>
        <div className="actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!canSubmit}>
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
