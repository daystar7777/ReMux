use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AuthMethod {
    Password,
    Keyfile,
    Agent,
    Local,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ClipboardPolicy {
    Allow,
    Ask,
    Deny,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Host {
    pub id: String,
    pub label: String,
    pub address: String,
    #[serde(default)]
    pub port: u16,
    #[serde(default)]
    pub username: String,
    pub auth_method: AuthMethod,
    #[serde(default)]
    pub key_path: Option<String>,
    #[serde(default)]
    pub ssh_config_alias: Option<String>,
    #[serde(default)]
    pub proxy_jump: Option<String>,
    #[serde(default)]
    pub identity_agent: Option<String>,
    #[serde(default)]
    pub custom_tmux_binary: Option<String>,
    #[serde(default)]
    pub tmux_socket_path: Option<String>,
    #[serde(default)]
    pub detach_other_clients: bool,
    #[serde(default)]
    pub clipboard_policy: Option<ClipboardPolicy>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub display_alias: String,
    pub host_id: String,
    pub tmux_session_name: String,
    #[serde(default)]
    pub tmux_window_target: Option<String>,
    #[serde(default)]
    pub tmux_pane_target: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub hosts: Vec<Host>,
    pub profiles: Vec<Profile>,
    pub version: u32,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            hosts: Vec::new(),
            profiles: Vec::new(),
            version: 1,
        }
    }
}
