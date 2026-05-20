export interface TmuxVersion {
  major: number;
  minor: number;
  raw: string;
}

export const parseTmuxVersion = (raw: string): TmuxVersion | null => {
  const m = raw.match(/tmux\s+(\d+)(?:\.(\d+))?([a-z]?)/i);
  if (!m) return null;
  return {
    major: parseInt(m[1], 10),
    minor: m[2] ? parseInt(m[2], 10) : 0,
    raw: m[0],
  };
};

export const supportsModernMouse = (v: TmuxVersion): boolean =>
  v.major > 2 || (v.major === 2 && v.minor >= 1);

export const supportsUserOptions = (v: TmuxVersion): boolean => v.major >= 3;

export interface AttachArgs {
  session: string;
  detachOthers?: boolean;
  window?: string;
  pane?: string;
  socketPath?: string;
  tmuxBinary?: string;
}

export const attachOrCreateCommand = (a: AttachArgs): string[] => {
  const bin = a.tmuxBinary ?? "tmux";
  const args: string[] = [bin];
  if (a.socketPath) {
    args.push("-S", a.socketPath);
  }
  args.push("new-session", "-A");
  if (a.detachOthers) {
    args.push("-D");
  }
  args.push("-s", a.session);
  if (a.window) {
    args.push("-n", a.window);
  }
  args.push(";", "set-option", "-t", a.session, "mouse", "off");
  return args;
};

export const resizeZoomKeystroke = (): string =>
  `\x02z`;

export const sendKeysCommand = (target: string, text: string): string[] => [
  "send-keys",
  "-t",
  target,
  text,
];

export interface PaneIdentity {
  pane_id: string;
  window_id: string;
  session_id: string;
  session_name: string;
  window_index: number;
  window_name: string;
  window_layout?: string;
  pane_index: number;
  pane_title?: string;
  pane_pid?: number;
  pane_current_command?: string;
  pane_current_path?: string;
}

export const listPanesFormat = (): string =>
  [
    "#{pane_id}",
    "#{window_id}",
    "#{session_id}",
    "#{session_name}",
    "#{window_index}",
    "#{window_name}",
    "#{window_layout}",
    "#{pane_index}",
    "#{pane_title}",
    "#{pane_pid}",
    "#{pane_current_command}",
    "#{pane_current_path}",
  ].join("\t");

export const parsePaneRow = (row: string): PaneIdentity | null => {
  const parts = row.split("\t");
  if (parts.length < 11) return null;
  const hasWindowLayout = parts.length >= 12;
  const paneIndexIdx = hasWindowLayout ? 7 : 6;
  const paneTitleIdx = hasWindowLayout ? 8 : 7;
  const panePidIdx = hasWindowLayout ? 9 : 8;
  const paneCommandIdx = hasWindowLayout ? 10 : 9;
  const panePathIdx = hasWindowLayout ? 11 : 10;
  return {
    pane_id: parts[0],
    window_id: parts[1],
    session_id: parts[2],
    session_name: parts[3],
    window_index: parseInt(parts[4], 10),
    window_name: parts[5],
    window_layout: hasWindowLayout ? parts[6] || undefined : undefined,
    pane_index: parseInt(parts[paneIndexIdx], 10),
    pane_title: parts[paneTitleIdx] || undefined,
    pane_pid: parts[panePidIdx] ? parseInt(parts[panePidIdx], 10) : undefined,
    pane_current_command: parts[paneCommandIdx] || undefined,
    pane_current_path: parts[panePathIdx] || undefined,
  };
};
