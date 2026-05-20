import type { Host } from "../types/config";

export const PASSWORD_REMOTE_INTERACTIVE_ONLY_LABEL = "remote interactive-only";

export const PASSWORD_REMOTE_COMMAND_CHANNEL_REASON =
  "Password-auth remote sessions attach interactively. Native tmux commands require key, agent, or ssh_config alias auth until REMUX has a command channel.";

export function supportsNativeTmuxCommands(host: Host | null | undefined): boolean {
  if (!host) return false;
  return host.auth_method !== "password";
}

export function nativeTmuxDisabledReason(
  host: Host | null | undefined,
  action = "Native tmux commands",
): string | undefined {
  if (!host || supportsNativeTmuxCommands(host)) return undefined;
  return `${action} require key/agent/alias auth until password sessions have a command channel.`;
}
