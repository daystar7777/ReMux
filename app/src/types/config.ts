export type AuthMethod = "password" | "keyfile" | "agent" | "local";

export type ClipboardPolicy = "allow" | "ask" | "deny";

export interface Host {
  id: string;
  label: string;
  address: string;
  port: number;
  username: string;
  auth_method: AuthMethod;
  key_path?: string;
  ssh_config_alias?: string;
  custom_tmux_binary?: string;
  tmux_socket_path?: string;
  detach_other_clients: boolean;
  clipboard_policy: ClipboardPolicy;
  description?: string;
  proxy_jump?: string;
  identity_agent?: string;
  skip_host_key_check?: boolean;
  last_resolved_ssh?: {
    address: string;
    port: number;
    username: string;
    key_path?: string;
    proxy_jump?: string;
  };
}

export interface Profile {
  id: string;
  display_alias: string;
  host_id: string;
  tmux_session_name: string;
  tmux_window_target?: string;
  tmux_pane_target?: string;
}

export interface AppConfig {
  hosts: Host[];
  profiles: Profile[];
  version: number;
}

export const CONFIG_VERSION = 1;

export const newHostId = () => `host_${crypto.randomUUID()}`;
export const newProfileId = () => `prof_${crypto.randomUUID()}`;
export const TMUX_SESSION_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

export const defaultLocalHost = (): Host => ({
  id: newHostId(),
  label: "localhost",
  address: "127.0.0.1",
  port: 0,
  username: "",
  auth_method: "local",
  detach_other_clients: false,
  clipboard_policy: "allow",
});

export const defaultLocalProfile = (hostId: string): Profile => ({
  id: newProfileId(),
  display_alias: "Local · remux-dev",
  host_id: hostId,
  tmux_session_name: "remux-dev",
});

export const validateHost = (host: Partial<Host>): string | null => {
  if (!host.label || !host.label.trim()) {
    return "Host name/label is required";
  }
  if (host.auth_method !== "local") {
    if (!host.address || !host.address.trim()) {
      return "Address is required for remote hosts";
    }
    if (host.port === undefined || host.port < 1 || host.port > 65535) {
      return "Port must be between 1 and 65535";
    }
    if (
      host.auth_method === "keyfile" &&
      (!host.key_path || !host.key_path.trim()) &&
      (!host.ssh_config_alias || !host.ssh_config_alias.trim())
    ) {
      return "Private key path or SSH config alias is required when auth method is keyfile";
    }
  }
  return null;
};

export const validateProfile = (profile: Partial<Profile>): string | null => {
  if (!profile.display_alias || !profile.display_alias.trim()) {
    return "Profile display alias is required";
  }
  if (!profile.host_id) {
    return "Please select a target host";
  }
  if (!profile.tmux_session_name || !profile.tmux_session_name.trim()) {
    return "Tmux session name is required";
  }
  if (!TMUX_SESSION_NAME_PATTERN.test(profile.tmux_session_name.trim())) {
    return "Tmux session name may only contain letters, numbers, dots, underscores, and hyphens";
  }
  return null;
};
