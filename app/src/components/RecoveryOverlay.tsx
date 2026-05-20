import { useState, useEffect } from "react";
import { AlertCircle, RefreshCw, XCircle } from "lucide-react";

interface Props {
  onRetry: () => void;
  onClose: () => void;
  countdown: number;
  bannerMessage?: string;
}

export function RecoveryOverlay({ onRetry, onClose, countdown, bannerMessage }: Props) {
  const [activeCountdown, setActiveCountdown] = useState(countdown);

  useEffect(() => {
    setActiveCountdown(countdown);
  }, [countdown]);

  useEffect(() => {
    if (activeCountdown <= 0) return;
    const timer = setInterval(() => {
      setActiveCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [activeCountdown]);

  return (
    <div className="recovery-overlay" role="alert" aria-live="assertive">
      <div className="recovery-card">
        <div className="recovery-header">
          <AlertCircle className="warning-icon" size={24} />
          <h3>Connection Interrupted</h3>
        </div>
        <p className="recovery-description">
          {bannerMessage || "The remote shell disconnected unexpectedly. Attempting to recover your tmux session..."}
        </p>
        <div className="recovery-status">
          {activeCountdown > 0 ? (
            <div className="countdown-timer">
              Retrying in <strong className="highlight">{activeCountdown}s</strong>...
            </div>
          ) : (
            <div className="retrying-spinner">
              <RefreshCw className="spinner animate-spin" size={16} />
              <span>Connecting now...</span>
            </div>
          )}
        </div>
        <div className="recovery-actions">
          <button className="secondary" onClick={onClose}>
            <XCircle size={14} style={{ marginRight: 6 }} />
            Close Pane
          </button>
          <button className="primary" onClick={onRetry} autoFocus>
            <RefreshCw size={14} style={{ marginRight: 6 }} />
            Retry Now
          </button>
        </div>
      </div>
    </div>
  );
}
