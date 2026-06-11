import { invoke, Channel } from "@tauri-apps/api/core";
import {
  readText as clipReadText,
  writeText as clipWriteText,
} from "@tauri-apps/plugin-clipboard-manager";

export type PtyEvent =
  | { kind: "data"; data: string }
  | { kind: "exit"; code: number | null }
  | { kind: "fingerprint"; challenge: string };

export interface SpawnLocalArgs {
  shell?: string;
  cwd?: string;
  cols: number;
  rows: number;
  channel: Channel<PtyEvent>;
}

export interface SpawnTmuxArgs {
  session: string;
  detachOthers: boolean;
  window?: string;
  socketPath?: string;
  tmuxBinary?: string;
  cols: number;
  rows: number;
  channel: Channel<PtyEvent>;
  mouseMode?: boolean;
}

export interface SpawnSshArgs {
  user?: string;
  host: string;
  port?: number;
  sshConfigAlias?: string;
  keyPath?: string;
  proxyJump?: string;
  identityAgent?: string;
  tmuxSession?: string;
  tmuxWindow?: string;
  password?: string;
  passwordAuth?: boolean;
  detachOthers?: boolean;
  cols: number;
  rows: number;
  channel: Channel<PtyEvent>;
  skipHostKeyCheck?: boolean;
  mouseMode?: boolean;
}

export async function ptySpawnLocal(args: SpawnLocalArgs): Promise<string> {
  return invoke<string>("pty_spawn_local", { ...args });
}

export async function ptySpawnTmuxLocal(args: SpawnTmuxArgs): Promise<string> {
  return invoke<string>("pty_spawn_tmux_local", { ...args });
}

export async function ptySpawnSshTmux(args: SpawnSshArgs): Promise<string> {
  return invoke<string>("pty_spawn_ssh_tmux", { ...args });
}

export async function ptyWrite(sessionId: string, data: string): Promise<void> {
  return invoke<void>("pty_write", { sessionId, data });
}

export async function ptyResize(sessionId: string, cols: number, rows: number): Promise<void> {
  return invoke<void>("pty_resize", { sessionId, cols, rows });
}

export async function ptyKill(sessionId: string): Promise<void> {
  return invoke<void>("pty_kill", { sessionId });
}

export interface TmuxVersionInfo {
  raw: string;
  major: number;
  minor: number;
  modern_mouse: boolean;
  supports_user_options: boolean;
}

export async function tmuxLocalVersion(binary?: string): Promise<TmuxVersionInfo | null> {
  return invoke<TmuxVersionInfo | null>("tmux_local_version", { binary });
}

export interface TmuxPaneIdentity {
  paneId: string;
  windowId: string;
  sessionId: string;
  sessionName: string;
  windowIndex: number;
  windowName: string;
  windowLayout?: string;
  paneIndex: number;
  paneTitle?: string;
  panePid?: number;
  paneCurrentCommand?: string;
  paneCurrentPath?: string;
}

export async function tmuxListLocalPanes(args: {
  binary?: string;
  socketPath?: string;
} = {}): Promise<TmuxPaneIdentity[]> {
  return invoke<TmuxPaneIdentity[]>("tmux_list_local_panes", args);
}

export async function tmuxListRemotePanes(args: {
  host: string;
  user?: string;
  port?: number;
  sshConfigAlias?: string;
  keyPath?: string;
  proxyJump?: string;
  identityAgent?: string;
  tmuxBinary?: string;
  socketPath?: string;
  skipHostKeyCheck?: boolean;
}): Promise<TmuxPaneIdentity[]> {
  return invoke<TmuxPaneIdentity[]>("tmux_list_remote_panes", args);
}

export interface LocalTmuxTargetArgs {
  target: string;
  binary?: string;
  socketPath?: string;
}

export type TmuxLayoutPreset = "even" | "main-left" | "main-top";

export interface RemoteTmuxTargetArgs {
  host: string;
  user?: string;
  port?: number;
  sshConfigAlias?: string;
  keyPath?: string;
  proxyJump?: string;
  identityAgent?: string;
  target: string;
  tmuxBinary?: string;
  socketPath?: string;
  skipHostKeyCheck?: boolean;
}

export async function tmuxSplitLocalPane(args: LocalTmuxTargetArgs & { direction: "row" | "column" | "down" | "right" }): Promise<void> {
  return invoke<void>("tmux_split_local_pane", { ...args });
}

export async function tmuxKillLocalPane(args: LocalTmuxTargetArgs): Promise<void> {
  return invoke<void>("tmux_kill_local_pane", { ...args });
}

export async function tmuxSelectLocalPane(args: LocalTmuxTargetArgs): Promise<void> {
  return invoke<void>("tmux_select_local_pane", { ...args });
}

export async function tmuxZoomLocalPane(args: LocalTmuxTargetArgs): Promise<void> {
  return invoke<void>("tmux_zoom_local_pane", { ...args });
}

export type TmuxResizeDirection = "left" | "right" | "up" | "down";

export async function tmuxResizeLocalPane(args: LocalTmuxTargetArgs & { direction: TmuxResizeDirection; amount: number }): Promise<void> {
  return invoke<void>("tmux_resize_local_pane", { ...args });
}

export async function tmuxSelectLocalLayout(args: LocalTmuxTargetArgs & { preset: TmuxLayoutPreset }): Promise<void> {
  return invoke<void>("tmux_select_local_layout", { ...args });
}

export async function tmuxRenameLocalWindow(args: LocalTmuxTargetArgs & { name: string }): Promise<void> {
  return invoke<void>("tmux_rename_local_window", { ...args });
}

export async function tmuxRenameLocalSession(args: LocalTmuxTargetArgs & { name: string }): Promise<void> {
  return invoke<void>("tmux_rename_local_session", { ...args });
}

export async function tmuxRenameLocalPane(args: LocalTmuxTargetArgs & { title: string }): Promise<void> {
  return invoke<void>("tmux_rename_local_pane", { ...args });
}

export async function tmuxSetLocalMouse(args: LocalTmuxTargetArgs & { enabled: boolean }): Promise<void> {
  return invoke<void>("tmux_set_local_mouse", { ...args });
}

export async function tmuxNewLocalWindow(args: LocalTmuxTargetArgs): Promise<void> {
  return invoke<void>("tmux_new_local_window", { ...args });
}

export async function tmuxKillLocalWindow(args: LocalTmuxTargetArgs): Promise<void> {
  return invoke<void>("tmux_kill_local_window", { ...args });
}

export async function tmuxSplitRemotePane(args: RemoteTmuxTargetArgs & { direction: "row" | "column" | "down" | "right" }): Promise<void> {
  return invoke<void>("tmux_split_remote_pane", { ...args });
}

export async function tmuxKillRemotePane(args: RemoteTmuxTargetArgs): Promise<void> {
  return invoke<void>("tmux_kill_remote_pane", { ...args });
}

export async function tmuxZoomRemotePane(args: RemoteTmuxTargetArgs): Promise<void> {
  return invoke<void>("tmux_zoom_remote_pane", { ...args });
}

export async function tmuxResizeRemotePane(args: RemoteTmuxTargetArgs & { direction: TmuxResizeDirection; amount: number }): Promise<void> {
  return invoke<void>("tmux_resize_remote_pane", { ...args });
}

export async function tmuxSelectRemotePane(args: RemoteTmuxTargetArgs): Promise<void> {
  return invoke<void>("tmux_select_remote_pane", { ...args });
}

export async function tmuxSelectRemoteLayout(args: RemoteTmuxTargetArgs & { preset: TmuxLayoutPreset }): Promise<void> {
  return invoke<void>("tmux_select_remote_layout", { ...args });
}

export async function tmuxRenameRemoteWindow(args: RemoteTmuxTargetArgs & { name: string }): Promise<void> {
  return invoke<void>("tmux_rename_remote_window", { ...args });
}

export async function tmuxRenameRemoteSession(args: RemoteTmuxTargetArgs & { name: string }): Promise<void> {
  return invoke<void>("tmux_rename_remote_session", { ...args });
}

export async function tmuxRenameRemotePane(args: RemoteTmuxTargetArgs & { title: string }): Promise<void> {
  return invoke<void>("tmux_rename_remote_pane", { ...args });
}

export async function tmuxSetRemoteMouse(args: RemoteTmuxTargetArgs & { enabled: boolean }): Promise<void> {
  return invoke<void>("tmux_set_remote_mouse", { ...args });
}

export async function tmuxNewRemoteWindow(args: RemoteTmuxTargetArgs): Promise<void> {
  return invoke<void>("tmux_new_remote_window", { ...args });
}

export async function tmuxKillRemoteWindow(args: RemoteTmuxTargetArgs): Promise<void> {
  return invoke<void>("tmux_kill_remote_window", { ...args });
}

export interface TmuxPaneNode {
  paneId: string;
  paneIndex: number;
  paneTitle?: string;
  panePid?: number;
  paneCurrentCommand?: string;
  paneCurrentPath?: string;
}

export interface TmuxWindowNode {
  windowId: string;
  windowName: string;
  windowIndex: number;
  windowLayout?: string;
  panes: TmuxPaneNode[];
}

export interface TmuxSessionNode {
  sessionId: string;
  sessionName: string;
  windows: TmuxWindowNode[];
}

export async function tmuxProbeHierarchy(args: {
  host?: string;
  user?: string;
  port?: number;
  sshConfigAlias?: string;
  keyPath?: string;
  proxyJump?: string;
  identityAgent?: string;
  tmuxBinary?: string;
  socketPath?: string;
  skipHostKeyCheck?: boolean;
} = {}): Promise<TmuxSessionNode[]> {
  return invoke<TmuxSessionNode[]>("tmux_probe_hierarchy", args);
}

export async function getProcessMemory(args: {
  pid: number;
  host?: string;
  user?: string;
  port?: number;
  sshConfigAlias?: string;
  keyPath?: string;
  proxyJump?: string;
  identityAgent?: string;
  skipHostKeyCheck?: boolean;
}): Promise<number> {
  return invoke<number>("get_process_memory", args);
}


export interface RemoteEnvProbe {
  lang?: string;
  lcCtype?: string;
  tmuxPresent: boolean;
  tmuxVersion?: TmuxVersionInfo;
  utf8Ok: boolean;
}

export async function probeRemoteEnv(args: {
  host: string;
  user?: string;
  port?: number;
  sshConfigAlias?: string;
  keyPath?: string;
  proxyJump?: string;
  identityAgent?: string;
  skipHostKeyCheck?: boolean;
  customTmuxBinary?: string;
}): Promise<RemoteEnvProbe> {
  return invoke<RemoteEnvProbe>("probe_remote_env", args);
}

export async function loadConfig(): Promise<unknown> {
  return invoke<unknown>("config_load");
}

export async function saveConfig(payload: unknown): Promise<void> {
  return invoke<void>("config_save", { payload });
}

export async function clipboardRead(): Promise<string> {
  return (await clipReadText()) ?? "";
}

export async function clipboardWrite(text: string): Promise<void> {
  await clipWriteText(text);
}

export async function openNewWindow(): Promise<string> {
  return invoke<string>("open_new_window");
}

export async function logDebug(msg: string): Promise<void> {
  return invoke<void>("log_debug", { msg });
}

export const REMUX_SERVICE = "com.remux.app";
export const hostAccount = (hostId: string) => `host:${hostId}`;
export const passphraseAccount = (hostId: string) => `passphrase:${hostId}`;

export async function secretsSet(account: string, secret: string, service: string = REMUX_SERVICE): Promise<void> {
  await invoke<void>("secrets_set", { service, account, secret });
}

export async function secretsGet(account: string, service: string = REMUX_SERVICE): Promise<string | null> {
  return invoke<string | null>("secrets_get", { service, account });
}

export async function secretsDelete(account: string, service: string = REMUX_SERVICE): Promise<void> {
  await invoke<void>("secrets_delete", { service, account });
}

export interface TestConnectionResult {
  ok: boolean;
  rttMs: number;
  detail: string;
}

export async function testConnection(args: {
  host: string;
  user?: string;
  port?: number;
  sshConfigAlias?: string;
  keyPath?: string;
  proxyJump?: string;
  identityAgent?: string;
  skipHostKeyCheck?: boolean;
}): Promise<TestConnectionResult> {
  return invoke<TestConnectionResult>("test_connection", args);
}

export { Channel };
