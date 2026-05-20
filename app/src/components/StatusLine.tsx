import { ClipboardCopy } from "lucide-react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  activeHostAtom,
  activeProfileAtom,
  activeTabAtom,
  clipboardAtom,
  diagnosticsAtom,
  imeComposingAtom,
  inputBroadcastAtom,
  localeWarningAtom,
  mousePolicyAtom,
  tmuxVersionLabelAtom,
  viewModeAtom,
  type ViewMode,
  type PaneLayout,
} from "../state/atoms";
import {
  PASSWORD_REMOTE_COMMAND_CHANNEL_REASON,
  PASSWORD_REMOTE_INTERACTIVE_ONLY_LABEL,
  nativeTmuxDisabledReason,
  supportsNativeTmuxCommands,
} from "../lib/remotePolicy";
import { summarize } from "../lib/clipboard";
import { clipboardWrite } from "../lib/ipc";
import { REMOTE_UTF8_LOCALE_FIX } from "../lib/locale";

const VIEW_MODE_LABEL: Record<string, string> = {
  normal: "Normal",
  focus: "Zoom",
  layout: "Layout",
  readonly: "Read-only",
  follow: "Follow",
  sync: "Sync-input",
};

const findLeaf = (node: PaneLayout | undefined, paneId: string | undefined): Extract<PaneLayout, { type: "leaf" }> | null => {
  if (!node || !paneId) return null;
  if (node.type === "leaf") return node.id === paneId ? node : null;
  for (const child of node.children) {
    const found = findLeaf(child, paneId);
    if (found) return found;
  }
  return null;
};

export function StatusLine() {
  const tab = useAtomValue(activeTabAtom);
  const host = useAtomValue(activeHostAtom);
  const profile = useAtomValue(activeProfileAtom);
  const clipboard = useAtomValue(clipboardAtom);
  const [viewMode, setViewMode] = useAtom(viewModeAtom);
  const composing = useAtomValue(imeComposingAtom);
  const locale = useAtomValue(localeWarningAtom);
  const setClipboard = useSetAtom(clipboardAtom);
  const tmuxVer = useAtomValue(tmuxVersionLabelAtom);
  const [mousePolicy, setMousePolicy] = useAtom(mousePolicyAtom);
  const [broadcastRecord, setBroadcastRecord] = useAtom(inputBroadcastAtom);
  const diagnostics = useAtomValue(diagnosticsAtom);

  const formatMemory = (kb?: number) => {
    if (kb === undefined) return "—";
    if (kb >= 1024 * 1024) {
      return `${(kb / (1024 * 1024)).toFixed(1)} GB`;
    }
    if (kb >= 1024) {
      return `${(kb / 1024).toFixed(1)} MB`;
    }
    return `${kb} KB`;
  };

  const hostLabel = host ? `${host.label}${host.port && host.port !== 22 ? ":" + host.port : ""}` : "—";
  const target = profile ? profile.tmux_session_name : "—";
  const activeLeaf = findLeaf(tab?.layout, tab?.activePaneId);
  const paneId = activeLeaf?.tmuxIdentity
    ? `${activeLeaf.tmuxIdentity.sessionName}:${activeLeaf.tmuxIdentity.windowIndex}.${activeLeaf.tmuxIdentity.paneIndex}`
    : tab?.activePaneId ?? "—";
  const rtt = tab?.rttMs;
  const paneDiag = tab?.activePaneId ? diagnostics[tab.activePaneId] : undefined;
  const nativeTmuxCommandsEnabled = supportsNativeTmuxCommands(host);
  const remoteInteractiveOnly = host ? !nativeTmuxCommandsEnabled : false;
  const mouseDisabledReason = nativeTmuxDisabledReason(
    host,
    "Mouse handoff",
  );

  const isBroadcast = tab ? !!broadcastRecord[tab.id] : false;
  const toggleBroadcast = () => {
    if (!tab) return;
    const nextBroadcast = !isBroadcast;
    setBroadcastRecord({
      ...broadcastRecord,
      [tab.id]: nextBroadcast,
    });
    if (nextBroadcast) {
      setViewMode("sync");
    } else if (viewMode === "sync") {
      setViewMode("normal");
    }
  };

  const setView = (mode: ViewMode) => {
    setViewMode(mode);
    if (!tab) return;
    if (mode === "sync") {
      setBroadcastRecord({
        ...broadcastRecord,
        [tab.id]: true,
      });
    } else if (viewMode === "sync") {
      setBroadcastRecord({
        ...broadcastRecord,
        [tab.id]: false,
      });
    }
  };

  const viewModes: Array<{ value: ViewMode; label: string; title: string }> = [
    { value: "normal", label: "N", title: "Normal view" },
    { value: "focus", label: "Z", title: "Zoom/focus active pane" },
    { value: "layout", label: "L", title: "Layout view" },
    { value: "readonly", label: "R", title: "Read-only inspect mode" },
    { value: "follow", label: "F", title: "Follow pane output" },
    { value: "sync", label: "S", title: "Sync-input mode" },
  ];

  const copyLocaleFix = async () => {
    await clipboardWrite(REMOTE_UTF8_LOCALE_FIX);
    setClipboard(summarize(REMOTE_UTF8_LOCALE_FIX));
  };

  return (
    <div className="status-line">
      <span className="field">
        <strong>host</strong> {hostLabel}
      </span>
      {remoteInteractiveOnly && (
        <>
          <span className="sep" />
          <span
            className="field warn"
            title={PASSWORD_REMOTE_COMMAND_CHANNEL_REASON}
          >
            <strong>remote</strong> {PASSWORD_REMOTE_INTERACTIVE_ONLY_LABEL.replace("remote ", "")}
          </span>
        </>
      )}
      <span className="sep" />
      <span className="field">
        <strong>tmux</strong> {target}
        {tmuxVer ? ` (${tmuxVer})` : ""}
      </span>
      <span className="sep" />
      <span className="field">
        <strong>pane</strong> {paneId}
      </span>
      {activeLeaf?.tmuxIdentity?.panePid && (
        <>
          <span className="sep" />
          <span className="field" title={`Active Process Command: ${activeLeaf.tmuxIdentity.paneCurrentCommand || "unknown"}`}>
            <strong>pid</strong> {activeLeaf.tmuxIdentity.panePid} {activeLeaf.tmuxIdentity.paneCurrentCommand ? `(${activeLeaf.tmuxIdentity.paneCurrentCommand})` : ""}
          </span>
        </>
      )}
      {paneDiag?.memoryKb !== undefined && (
        <>
          <span className="sep" />
          <span className="field">
            <strong>mem</strong> {formatMemory(paneDiag.memoryKb)}
          </span>
        </>
      )}
      {paneDiag?.heartbeatStatus && (
        <>
          <span className="sep" />
          <span className="field" style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <strong>heartbeat</strong>
            <span
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background:
                  paneDiag.heartbeatStatus === "stable"
                    ? "var(--ok)"
                    : paneDiag.heartbeatStatus === "lagging"
                      ? "var(--warn)"
                      : "var(--danger)",
                boxShadow:
                  paneDiag.heartbeatStatus === "stable"
                    ? "0 0 6px var(--ok)"
                    : paneDiag.heartbeatStatus === "lagging"
                      ? "0 0 6px var(--warn)"
                      : "0 0 6px var(--danger)",
                display: "inline-block",
              }}
              title={`SSH Keepalive state is ${paneDiag.heartbeatStatus}`}
            />
            <span style={{ fontSize: "10px", color: "var(--fg-2)" }}>{paneDiag.heartbeatStatus}</span>
          </span>
        </>
      )}
      <span className="sep" />
      <span className="field" title={VIEW_MODE_LABEL[viewMode] ?? viewMode}>
        <strong>view</strong>
        <span style={{ display: "inline-flex", gap: 2, alignItems: "center" }}>
          {viewModes.map((mode) => (
            <button
              key={mode.value}
              className="icon-btn"
              onClick={() => setView(mode.value)}
              title={mode.title}
              aria-label={mode.title}
              style={{
                width: 20,
                height: 18,
                padding: 0,
                fontSize: 10,
                borderColor: viewMode === mode.value ? "var(--accent-dim)" : "transparent",
                color: viewMode === mode.value ? "var(--accent)" : "var(--fg-1)",
                background: viewMode === mode.value ? "rgba(106, 169, 255, 0.1)" : "transparent",
              }}
            >
              {mode.label}
            </button>
          ))}
        </span>
      </span>
      <span className="sep" />
      <span className="clip" title={clipboard.preview}>
        <strong>clip</strong>
        <span className={`clip-text${clipboard.redacted ? " redacted" : ""}`}>
          {clipboard.preview || "—"}
        </span>
        {clipboard.kind !== "empty" && (
          <span style={{ color: "var(--fg-2)", fontSize: 10 }}>
            {clipboard.lineCount}L · {clipboard.byteLength}B
          </span>
        )}
      </span>
      <span className="sep" />
      <span className="field">
        <strong>ime</strong> {composing ? "composing" : "idle"}
      </span>
      <span className="sep" />
      <button
        className="icon-btn"
        style={{
          width: "auto",
          padding: "0 8px",
          fontSize: 11,
          borderColor: isBroadcast ? "var(--accent)" : "transparent",
          color: isBroadcast ? "var(--accent)" : "var(--fg-1)",
          background: isBroadcast ? "rgba(106, 169, 255, 0.08)" : "transparent",
          transition: "all 0.15s ease",
        }}
        onClick={toggleBroadcast}
        title={
          isBroadcast
            ? "Broadcast active. Keypress fanned to all panes in tab."
            : "Broadcast inactive. Keypress sent to active pane only."
        }
      >
        <strong>broadcast</strong>&nbsp;{isBroadcast ? "ON" : "OFF"}
      </button>
      <span className="sep" />
      <button
        className="icon-btn"
        disabled={remoteInteractiveOnly}
        style={{
          width: "auto",
          padding: "0 8px",
          fontSize: 11,
          opacity: remoteInteractiveOnly ? 0.45 : 1,
        }}
        onClick={() => {
          if (remoteInteractiveOnly) return;
          setMousePolicy(mousePolicy === "remux" ? "tmux" : "remux");
        }}
        title={
          remoteInteractiveOnly
            ? mouseDisabledReason
            : mousePolicy === "remux"
            ? "REMUX handles mouse. Click to hand mouse events to tmux/remote."
            : "tmux/remote handles mouse. Click to take mouse back to REMUX."
        }
      >
        <strong>mouse</strong>&nbsp;{remoteInteractiveOnly ? "REMUX*" : mousePolicy === "remux" ? "REMUX" : "tmux"}
      </button>
      {locale && (
        <>
          <span className="sep" />
          <span className="field warn">{locale}</span>
          <button
            className="icon-btn"
            onClick={() => void copyLocaleFix()}
            title="Copy UTF-8 locale fix"
            aria-label="Copy UTF-8 locale fix"
            style={{ width: 20, height: 18, padding: 0 }}
          >
            <ClipboardCopy size={12} strokeWidth={1.8} />
          </button>
        </>
      )}
      {typeof rtt === "number" && (
        <>
          <span className="sep" />
          <span className="field">
            <strong>rtt</strong> {rtt}ms
          </span>
        </>
      )}
    </div>
  );
}
