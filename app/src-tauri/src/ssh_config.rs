use serde::Serialize;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigHost {
    pub alias: String,
    pub address: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub key_path: Option<String>,
    pub proxy_jump: Option<String>,
    pub identity_agent: Option<String>,
}

/// Helper to resolve the path of ~/.ssh/config
fn get_ssh_config_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".ssh").join("config"))
}

/// Reads the local ~/.ssh/config file and extracts all plain Host aliases
/// excluding wildcards.
pub fn list_hosts() -> Result<Vec<String>, String> {
    let path = get_ssh_config_path().ok_or_else(|| "Could not determine home directory".to_string())?;
    if !path.exists() {
        return Ok(vec![]);
    }

    let file = File::open(path).map_err(|e| format!("Failed to open ssh config: {e}"))?;
    let reader = BufReader::new(file);
    let mut aliases = Vec::new();

    for line in reader.lines() {
        let line = line.map_err(|e| format!("Failed to read ssh config line: {e}"))?;
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            continue;
        }

        // Host block can define multiple space-separated aliases e.g., "Host hostA hostB"
        if trimmed.to_lowercase().starts_with("host ") {
            let parts = trimmed[5..].split_whitespace();
            for part in parts {
                let clean = part.trim();
                if !clean.is_empty() && !clean.contains('*') && !clean.contains('?') && clean.to_lowercase() != "key" {
                    aliases.push(clean.to_string());
                }
            }
        }
    }

    aliases.sort();
    aliases.dedup();
    Ok(aliases)
}

/// Resolves a canonical host configuration by spawning `ssh -G <alias>`.
pub fn resolve_host(alias: String) -> Result<SshConfigHost, String> {
    // Basic shell injection guard: ensure alias doesn't start with hyphen or contain invalid chars
    if alias.starts_with('-') || alias.contains(' ') || alias.contains(';') || alias.contains('&') || alias.contains('|') {
        return Err("Invalid SSH config alias format".to_string());
    }

    let output = Command::new("ssh")
        .args(["-G", &alias])
        .output()
        .map_err(|e| format!("Failed to execute ssh -G: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "ssh -G failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let content = String::from_utf8_lossy(&output.stdout);
    let mut address = None;
    let mut port = None;
    let mut username = None;
    let mut key_path = None;
    let mut proxy_jump = None;
    let mut identity_agent = None;

    for line in content.lines() {
        let mut parts = line.split_whitespace();
        let directive = parts.next();
        let value = parts.next();

        if let (Some(dir), Some(val)) = (directive, value) {
            let dir_lower = dir.to_lowercase();
            match dir_lower.as_str() {
                "hostname" => {
                    // Only use if it is not just the exact same as alias (ssh -G returns fallback if unresolved,
                    // but we will keep it as address)
                    address = Some(val.to_string());
                }
                "port" => {
                    if let Ok(p) = val.parse::<u16>() {
                        port = Some(p);
                    }
                }
                "user" => {
                    username = Some(val.to_string());
                }
                "identityfile" => {
                    // ssh -G returns default identity files (like ~/.ssh/id_rsa) even if they don't exist.
                    // We only want to capture if it is a specific custom key file or if it's explicitly defined.
                    // To keep it simple, we filter out "~/.ssh/id_dsa", "~/.ssh/id_ecdsa", "~/.ssh/id_ecdsa_sk",
                    // "~/.ssh/id_ed25519", "~/.ssh/id_ed25519_sk", "~/.ssh/id_rsa".
                    let val_trimmed = val.replace("~", &dirs::home_dir().unwrap_or_default().to_string_lossy());
                    let p = std::path::Path::new(&val_trimmed);
                    if p.exists() {
                        key_path = Some(val_trimmed);
                    }
                }
                "proxyjump" => {
                    if val != "none" {
                        proxy_jump = Some(val.to_string());
                    }
                }
                "identityagent" => {
                    if val != "none" {
                        identity_agent = Some(val.to_string());
                    }
                }
                _ => {}
            }
        }
    }

    Ok(SshConfigHost {
        alias,
        address,
        port,
        username,
        key_path,
        proxy_jump,
        identity_agent,
    })
}
