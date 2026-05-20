use crate::types::{AppConfig, AuthMethod, Host, Profile};
use anyhow::{anyhow, Context, Result};
use std::fs;
use std::path::PathBuf;

const APP_ID: &str = "com.remux.app";

pub fn config_dir() -> Result<PathBuf> {
    let base = dirs::data_dir().context("could not resolve user data dir")?;
    let dir = base.join(APP_ID);
    fs::create_dir_all(&dir).context("create REMUX config dir")?;
    Ok(dir)
}

pub fn config_path() -> Result<PathBuf> {
    Ok(config_dir()?.join("config.json"))
}

pub fn load() -> Result<AppConfig> {
    let path = config_path()?;
    if !path.exists() {
        // Soft migrate from the legacy `REMUX/` directory if present.
        if let Some(base) = dirs::data_dir() {
            let legacy = base.join("REMUX").join("config.json");
            if legacy.exists() {
                let raw = fs::read_to_string(&legacy).context("read legacy config file")?;
                let cfg: AppConfig =
                    serde_json::from_str(&raw).context("parse legacy config file")?;
                validate(&cfg).context("validate legacy config file")?;
                let _ = fs::create_dir_all(config_dir()?);
                let _ = fs::write(&path, serde_json::to_string_pretty(&cfg)?);
                return Ok(cfg);
            }
        }
        return Ok(AppConfig::default());
    }
    let raw = fs::read_to_string(&path).context("read config file")?;
    let cfg: AppConfig = serde_json::from_str(&raw).context("parse config file")?;
    validate(&cfg).context("validate config file")?;
    Ok(cfg)
}

pub fn save(cfg: &AppConfig) -> Result<()> {
    validate(cfg)?;
    let path = config_path()?;
    let raw = serde_json::to_string_pretty(cfg).context("serialize config")?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, raw).context("write tmp config")?;
    fs::rename(&tmp, &path).context("rename tmp config into place")?;
    Ok(())
}

fn validate(cfg: &AppConfig) -> Result<()> {
    let mut host_ids = std::collections::HashSet::new();
    for h in &cfg.hosts {
        validate_host(h)?;
        if !host_ids.insert(h.id.clone()) {
            return Err(anyhow!("duplicate host id: {}", h.id));
        }
    }
    let mut profile_ids = std::collections::HashSet::new();
    for p in &cfg.profiles {
        validate_profile(p, &host_ids)?;
        if !profile_ids.insert(p.id.clone()) {
            return Err(anyhow!("duplicate profile id: {}", p.id));
        }
    }
    Ok(())
}

fn validate_host(h: &Host) -> Result<()> {
    if h.id.trim().is_empty() {
        return Err(anyhow!("host.id is empty"));
    }
    if h.label.trim().is_empty() {
        return Err(anyhow!("host.label is empty"));
    }
    if h.auth_method != AuthMethod::Local {
        if h.address.trim().is_empty() {
            return Err(anyhow!("host.address is empty for non-local host"));
        }
        if h.port == 0 {
            return Err(anyhow!("host.port must be > 0 for non-local host"));
        }
        if h.auth_method == AuthMethod::Keyfile
            && h.key_path.as_deref().unwrap_or("").trim().is_empty()
            && h.ssh_config_alias.as_deref().unwrap_or("").trim().is_empty()
        {
            return Err(anyhow!(
                "host.key_path or ssh_config_alias required for keyfile auth"
            ));
        }
    }
    Ok(())
}

fn validate_profile(p: &Profile, host_ids: &std::collections::HashSet<String>) -> Result<()> {
    if p.id.trim().is_empty() {
        return Err(anyhow!("profile.id is empty"));
    }
    if p.host_id.trim().is_empty() {
        return Err(anyhow!("profile.host_id is empty"));
    }
    if !host_ids.contains(&p.host_id) {
        return Err(anyhow!("profile.host_id references unknown host"));
    }
    let session = p.tmux_session_name.trim();
    if session.is_empty() {
        return Err(anyhow!("profile.tmux_session_name is empty"));
    }
    if !session
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err(anyhow!(
            "profile.tmux_session_name must match [A-Za-z0-9_.-]"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::ClipboardPolicy;

    fn local_host(id: &str) -> Host {
        Host {
            id: id.into(),
            label: "Local".into(),
            address: String::new(),
            port: 0,
            username: String::new(),
            auth_method: AuthMethod::Local,
            key_path: None,
            ssh_config_alias: None,
            proxy_jump: None,
            identity_agent: None,
            custom_tmux_binary: None,
            tmux_socket_path: None,
            detach_other_clients: false,
            clipboard_policy: Some(ClipboardPolicy::Allow),
            description: None,
        }
    }

    fn profile(id: &str, host_id: &str, session: &str) -> Profile {
        Profile {
            id: id.into(),
            display_alias: "Work".into(),
            host_id: host_id.into(),
            tmux_session_name: session.into(),
            tmux_window_target: None,
            tmux_pane_target: None,
        }
    }

    #[test]
    fn validates_good_config() {
        let cfg = AppConfig {
            hosts: vec![local_host("local")],
            profiles: vec![profile("work", "local", "remux.work")],
            version: 1,
        };

        validate(&cfg).expect("valid config");
    }

    #[test]
    fn rejects_duplicate_host_ids() {
        let cfg = AppConfig {
            hosts: vec![local_host("local"), local_host("local")],
            profiles: vec![],
            version: 1,
        };

        let err = validate(&cfg).expect_err("duplicate host id should fail");
        assert!(err.to_string().contains("duplicate host id"));
    }

    #[test]
    fn rejects_profile_unknown_host() {
        let cfg = AppConfig {
            hosts: vec![local_host("local")],
            profiles: vec![profile("work", "missing", "remux")],
            version: 1,
        };

        let err = validate(&cfg).expect_err("unknown host should fail");
        assert!(err.to_string().contains("references unknown host"));
    }

    #[test]
    fn rejects_invalid_tmux_session_name() {
        let cfg = AppConfig {
            hosts: vec![local_host("local")],
            profiles: vec![profile("work", "local", "bad session")],
            version: 1,
        };

        let err = validate(&cfg).expect_err("invalid session should fail");
        assert!(err.to_string().contains("tmux_session_name"));
    }

    #[test]
    fn rejects_keyfile_host_without_key_or_alias() {
        let mut host = local_host("remote");
        host.auth_method = AuthMethod::Keyfile;
        host.address = "example.com".into();
        host.port = 22;

        let cfg = AppConfig {
            hosts: vec![host],
            profiles: vec![],
            version: 1,
        };

        let err = validate(&cfg).expect_err("keyfile host without key should fail");
        assert!(err.to_string().contains("key_path or ssh_config_alias"));
    }
}
