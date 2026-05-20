mod config;
mod pty;
mod ssh;
mod tmux;
mod types;
mod keyring_bridge;
mod ssh_config;


use crate::pty::{PtyEvent, PtyManager, SpawnOptions};
use crate::ssh::{build_ssh_argv, build_ssh_probe_argv, build_ssh_remote_command_argv, SshLaunchArgs};
use crate::tmux::{
    build_attach_or_create, build_hierarchy, build_kill_pane, build_list_panes,
    build_rename_pane, build_rename_window, build_select_layout, build_select_pane, build_set_mouse, build_set_mouse_legacy, build_split_pane, build_zoom_pane,
    build_new_window, build_kill_window,
    detect_local_version, list_local_panes, parse_pane_row, AttachArgs, TmuxPaneIdentity,
    TmuxSessionNode, TmuxVersion,
};
use crate::types::AppConfig;
use serde::Serialize;
use std::sync::Arc;
use tauri::{ipc::Channel, AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use uuid::Uuid;

struct AppState {
    pty: Arc<PtyManager>,
}

fn opt_non_empty(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|s| !s.is_empty())
}

#[tauri::command]
async fn pty_spawn_local(
    state: State<'_, AppState>,
    shell: Option<String>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    channel: Channel<PtyEvent>,
) -> Result<String, String> {
    let shell = shell.unwrap_or_else(|| {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
    });
    let opts = SpawnOptions {
        cwd,
        ..Default::default()
    };
    state
        .pty
        .spawn(vec![shell, "-l".into()], cols, rows, channel, opts)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn pty_spawn_tmux_local(
    state: State<'_, AppState>,
    session: String,
    detach_others: bool,
    window: Option<String>,
    socket_path: Option<String>,
    tmux_binary: Option<String>,
    cols: u16,
    rows: u16,
    channel: Channel<PtyEvent>,
) -> Result<String, String> {
    let argv = build_attach_or_create(&AttachArgs {
        binary: tmux_binary.as_deref(),
        socket_path: socket_path.as_deref(),
        session: &session,
        detach_others,
        window: window.as_deref(),
    });
    state
        .pty
        .spawn(argv, cols, rows, channel, SpawnOptions::default())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn pty_spawn_ssh_tmux(
    state: State<'_, AppState>,
    host: String,
    user: Option<String>,
    port: Option<u16>,
    ssh_config_alias: Option<String>,
    key_path: Option<String>,
    proxy_jump: Option<String>,
    identity_agent: Option<String>,
    tmux_session: Option<String>,
    tmux_window: Option<String>,
    password: Option<String>,
    cols: u16,
    rows: u16,
    channel: Channel<PtyEvent>,
    skip_host_key_check: Option<bool>,
    password_auth: Option<bool>,
) -> Result<String, String> {
    let argv = build_ssh_argv(&SshLaunchArgs {
        user: opt_non_empty(user.as_deref()),
        host: host.trim(),
        port,
        ssh_config_alias: opt_non_empty(ssh_config_alias.as_deref()),
        key_path: opt_non_empty(key_path.as_deref()),
        proxy_jump: opt_non_empty(proxy_jump.as_deref()),
        identity_agent: opt_non_empty(identity_agent.as_deref()),
        tmux_session: opt_non_empty(tmux_session.as_deref()),
        tmux_window: opt_non_empty(tmux_window.as_deref()),
        skip_host_key_check: skip_host_key_check.unwrap_or(false),
        password_auth: password_auth.unwrap_or(false),
    });
    let opts = SpawnOptions {
        auto_password: password,
        ..Default::default()
    };
    state
        .pty
        .spawn(argv, cols, rows, channel, opts)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn pty_write(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    state
        .pty
        .write(&session_id, &data)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn pty_resize(
    state: State<'_, AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state
        .pty
        .resize(&session_id, cols, rows)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn pty_kill(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    state.pty.kill(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn tmux_local_version(binary: Option<String>) -> Result<Option<TmuxVersion>, String> {
    Ok(detect_local_version(binary.as_deref()))
}

#[tauri::command]
async fn tmux_list_local_panes(
    binary: Option<String>,
    socket_path: Option<String>,
) -> Result<Vec<TmuxPaneIdentity>, String> {
    list_local_panes(binary.as_deref(), socket_path.as_deref())
}

#[tauri::command]
async fn tmux_list_remote_panes(
    host: String,
    user: Option<String>,
    port: Option<u16>,
    ssh_config_alias: Option<String>,
    key_path: Option<String>,
    proxy_jump: Option<String>,
    identity_agent: Option<String>,
    tmux_binary: Option<String>,
    socket_path: Option<String>,
    skip_host_key_check: Option<bool>,
) -> Result<Vec<TmuxPaneIdentity>, String> {
    let remote = build_list_panes(&AttachArgs {
        binary: tmux_binary.as_deref(),
        socket_path: socket_path.as_deref(),
        session: "",
        detach_others: false,
        window: None,
    });
    let argv = build_ssh_remote_command_argv(
        &SshLaunchArgs {
            user: opt_non_empty(user.as_deref()),
            host: host.trim(),
            port,
            ssh_config_alias: opt_non_empty(ssh_config_alias.as_deref()),
            key_path: opt_non_empty(key_path.as_deref()),
            proxy_jump: opt_non_empty(proxy_jump.as_deref()),
            identity_agent: opt_non_empty(identity_agent.as_deref()),
            tmux_session: None,
            tmux_window: None,
            skip_host_key_check: skip_host_key_check.unwrap_or(false),
            password_auth: false,
        },
        &remote,
        true,
    );
    let output = tokio::process::Command::new(&argv[0])
        .args(&argv[1..])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let body = String::from_utf8_lossy(&output.stdout);
    Ok(body.lines().filter_map(parse_pane_row).collect())
}

fn run_local_tmux_command(argv: Vec<String>) -> Result<(), String> {
    let output = std::process::Command::new(&argv[0])
        .args(&argv[1..])
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

async fn run_remote_tmux_command(argv: Vec<String>) -> Result<(), String> {
    let output = tokio::process::Command::new(&argv[0])
        .args(&argv[1..])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[tauri::command]
async fn tmux_split_local_pane(
    target: String,
    direction: String,
    binary: Option<String>,
    socket_path: Option<String>,
) -> Result<(), String> {
    run_local_tmux_command(build_split_pane(
        binary.as_deref(),
        socket_path.as_deref(),
        &target,
        &direction,
    )?)
}

#[tauri::command]
async fn tmux_kill_local_pane(
    target: String,
    binary: Option<String>,
    socket_path: Option<String>,
) -> Result<(), String> {
    run_local_tmux_command(build_kill_pane(binary.as_deref(), socket_path.as_deref(), &target))
}

#[tauri::command]
async fn tmux_select_local_pane(
    target: String,
    binary: Option<String>,
    socket_path: Option<String>,
) -> Result<(), String> {
    run_local_tmux_command(build_select_pane(binary.as_deref(), socket_path.as_deref(), &target))
}

#[tauri::command]
async fn tmux_zoom_local_pane(
    target: String,
    binary: Option<String>,
    socket_path: Option<String>,
) -> Result<(), String> {
    run_local_tmux_command(build_zoom_pane(binary.as_deref(), socket_path.as_deref(), &target))
}

#[tauri::command]
async fn tmux_select_local_layout(
    target: String,
    preset: String,
    binary: Option<String>,
    socket_path: Option<String>,
) -> Result<(), String> {
    run_local_tmux_command(build_select_layout(
        binary.as_deref(),
        socket_path.as_deref(),
        &target,
        &preset,
    )?)
}

#[tauri::command]
async fn tmux_rename_local_window(
    target: String,
    name: String,
    binary: Option<String>,
    socket_path: Option<String>,
) -> Result<(), String> {
    run_local_tmux_command(build_rename_window(
        binary.as_deref(),
        socket_path.as_deref(),
        &target,
        &name,
    ))
}

#[tauri::command]
async fn tmux_rename_local_pane(
    target: String,
    title: String,
    binary: Option<String>,
    socket_path: Option<String>,
) -> Result<(), String> {
    match run_local_tmux_command(build_rename_pane(
        binary.as_deref(),
        socket_path.as_deref(),
        &target,
        &title,
    )) {
        Ok(()) => Ok(()),
        Err(e) if e.contains("unknown option: -T") || e.contains("bad option") => {
            Err("Pane renaming requires tmux 3.0 or higher.".to_string())
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
async fn tmux_set_local_mouse(
    target: String,
    enabled: bool,
    binary: Option<String>,
    socket_path: Option<String>,
) -> Result<(), String> {
    match run_local_tmux_command(build_set_mouse(
        binary.as_deref(),
        socket_path.as_deref(),
        &target,
        enabled,
    )) {
        Ok(()) => Ok(()),
        Err(e) if e.contains("unknown option") || e.contains("bad option") || e.contains("mouse") => {
            // Fallback to legacy mouse options for tmux < 2.1
            let legacy_cmds = build_set_mouse_legacy(
                binary.as_deref(),
                socket_path.as_deref(),
                &target,
                enabled,
            );
            for cmd in legacy_cmds {
                let _ = run_local_tmux_command(cmd);
            }
            Ok(())
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
async fn tmux_new_local_window(
    target: String,
    binary: Option<String>,
    socket_path: Option<String>,
) -> Result<(), String> {
    run_local_tmux_command(build_new_window(
        binary.as_deref(),
        socket_path.as_deref(),
        &target,
    ))
}

#[tauri::command]
async fn tmux_kill_local_window(
    target: String,
    binary: Option<String>,
    socket_path: Option<String>,
) -> Result<(), String> {
    run_local_tmux_command(build_kill_window(
        binary.as_deref(),
        socket_path.as_deref(),
        &target,
    ))
}

fn build_remote_tmux_op(
    host: &str,
    user: Option<&str>,
    port: Option<u16>,
    ssh_config_alias: Option<&str>,
    key_path: Option<&str>,
    proxy_jump: Option<&str>,
    identity_agent: Option<&str>,
    remote: Vec<String>,
    skip_host_key_check: bool,
) -> Vec<String> {
    build_ssh_remote_command_argv(
        &SshLaunchArgs {
            user: opt_non_empty(user),
            host: host.trim(),
            port,
            ssh_config_alias: opt_non_empty(ssh_config_alias),
            key_path: opt_non_empty(key_path),
            proxy_jump: opt_non_empty(proxy_jump),
            identity_agent: opt_non_empty(identity_agent),
            tmux_session: None,
            tmux_window: None,
            skip_host_key_check,
            password_auth: false,
        },
        &remote,
        true,
    )
}

#[tauri::command]
async fn tmux_split_remote_pane(
    host: String,
    user: Option<String>,
    port: Option<u16>,
    ssh_config_alias: Option<String>,
    key_path: Option<String>,
    proxy_jump: Option<String>,
    identity_agent: Option<String>,
    target: String,
    direction: String,
    tmux_binary: Option<String>,
    socket_path: Option<String>,
    skip_host_key_check: Option<bool>,
) -> Result<(), String> {
    let remote = build_split_pane(
        tmux_binary.as_deref(),
        socket_path.as_deref(),
        &target,
        &direction,
    )?;
    run_remote_tmux_command(build_remote_tmux_op(
        &host,
        user.as_deref(),
        port,
        ssh_config_alias.as_deref(),
        key_path.as_deref(),
        proxy_jump.as_deref(),
        identity_agent.as_deref(),
        remote,
        skip_host_key_check.unwrap_or(false),
    ))
    .await
}

#[tauri::command]
async fn tmux_kill_remote_pane(
    host: String,
    user: Option<String>,
    port: Option<u16>,
    ssh_config_alias: Option<String>,
    key_path: Option<String>,
    proxy_jump: Option<String>,
    identity_agent: Option<String>,
    target: String,
    tmux_binary: Option<String>,
    socket_path: Option<String>,
    skip_host_key_check: Option<bool>,
) -> Result<(), String> {
    let remote = build_kill_pane(tmux_binary.as_deref(), socket_path.as_deref(), &target);
    run_remote_tmux_command(build_remote_tmux_op(
        &host,
        user.as_deref(),
        port,
        ssh_config_alias.as_deref(),
        key_path.as_deref(),
        proxy_jump.as_deref(),
        identity_agent.as_deref(),
        remote,
        skip_host_key_check.unwrap_or(false),
    ))
    .await
}

#[tauri::command]
async fn tmux_zoom_remote_pane(
    host: String,
    user: Option<String>,
    port: Option<u16>,
    ssh_config_alias: Option<String>,
    key_path: Option<String>,
    proxy_jump: Option<String>,
    identity_agent: Option<String>,
    target: String,
    tmux_binary: Option<String>,
    socket_path: Option<String>,
    skip_host_key_check: Option<bool>,
) -> Result<(), String> {
    let remote = build_zoom_pane(tmux_binary.as_deref(), socket_path.as_deref(), &target);
    run_remote_tmux_command(build_remote_tmux_op(
        &host,
        user.as_deref(),
        port,
        ssh_config_alias.as_deref(),
        key_path.as_deref(),
        proxy_jump.as_deref(),
        identity_agent.as_deref(),
        remote,
        skip_host_key_check.unwrap_or(false),
    ))
    .await
}

#[tauri::command]
async fn tmux_select_remote_pane(
    host: String,
    user: Option<String>,
    port: Option<u16>,
    ssh_config_alias: Option<String>,
    key_path: Option<String>,
    proxy_jump: Option<String>,
    identity_agent: Option<String>,
    target: String,
    tmux_binary: Option<String>,
    socket_path: Option<String>,
    skip_host_key_check: Option<bool>,
) -> Result<(), String> {
    let remote = build_select_pane(tmux_binary.as_deref(), socket_path.as_deref(), &target);
    run_remote_tmux_command(build_remote_tmux_op(
        &host,
        user.as_deref(),
        port,
        ssh_config_alias.as_deref(),
        key_path.as_deref(),
        proxy_jump.as_deref(),
        identity_agent.as_deref(),
        remote,
        skip_host_key_check.unwrap_or(false),
    ))
    .await
}

#[tauri::command]
async fn tmux_select_remote_layout(
    host: String,
    user: Option<String>,
    port: Option<u16>,
    ssh_config_alias: Option<String>,
    key_path: Option<String>,
    proxy_jump: Option<String>,
    identity_agent: Option<String>,
    target: String,
    preset: String,
    tmux_binary: Option<String>,
    socket_path: Option<String>,
    skip_host_key_check: Option<bool>,
) -> Result<(), String> {
    let remote = build_select_layout(
        tmux_binary.as_deref(),
        socket_path.as_deref(),
        &target,
        &preset,
    )?;
    run_remote_tmux_command(build_remote_tmux_op(
        &host,
        user.as_deref(),
        port,
        ssh_config_alias.as_deref(),
        key_path.as_deref(),
        proxy_jump.as_deref(),
        identity_agent.as_deref(),
        remote,
        skip_host_key_check.unwrap_or(false),
    ))
    .await
}

#[tauri::command]
async fn tmux_rename_remote_window(
    host: String,
    user: Option<String>,
    port: Option<u16>,
    ssh_config_alias: Option<String>,
    key_path: Option<String>,
    proxy_jump: Option<String>,
    identity_agent: Option<String>,
    target: String,
    name: String,
    tmux_binary: Option<String>,
    socket_path: Option<String>,
    skip_host_key_check: Option<bool>,
) -> Result<(), String> {
    let remote = build_rename_window(
        tmux_binary.as_deref(),
        socket_path.as_deref(),
        &target,
        &name,
    );
    run_remote_tmux_command(build_remote_tmux_op(
        &host,
        user.as_deref(),
        port,
        ssh_config_alias.as_deref(),
        key_path.as_deref(),
        proxy_jump.as_deref(),
        identity_agent.as_deref(),
        remote,
        skip_host_key_check.unwrap_or(false),
    ))
    .await
}

#[tauri::command]
async fn tmux_rename_remote_pane(
    host: String,
    user: Option<String>,
    port: Option<u16>,
    ssh_config_alias: Option<String>,
    key_path: Option<String>,
    proxy_jump: Option<String>,
    identity_agent: Option<String>,
    target: String,
    title: String,
    tmux_binary: Option<String>,
    socket_path: Option<String>,
    skip_host_key_check: Option<bool>,
) -> Result<(), String> {
    let remote = build_rename_pane(
        tmux_binary.as_deref(),
        socket_path.as_deref(),
        &target,
        &title,
    );
    let op = build_remote_tmux_op(
        &host,
        user.as_deref(),
        port,
        ssh_config_alias.as_deref(),
        key_path.as_deref(),
        proxy_jump.as_deref(),
        identity_agent.as_deref(),
        remote,
        skip_host_key_check.unwrap_or(false),
    );
    match run_remote_tmux_command(op).await {
        Ok(()) => Ok(()),
        Err(e) if e.contains("unknown option: -T") || e.contains("bad option") => {
            Err("Pane renaming requires tmux 3.0 or higher.".to_string())
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
async fn tmux_set_remote_mouse(
    host: String,
    user: Option<String>,
    port: Option<u16>,
    ssh_config_alias: Option<String>,
    key_path: Option<String>,
    proxy_jump: Option<String>,
    identity_agent: Option<String>,
    target: String,
    enabled: bool,
    tmux_binary: Option<String>,
    socket_path: Option<String>,
    skip_host_key_check: Option<bool>,
) -> Result<(), String> {
    let remote = build_set_mouse(
        tmux_binary.as_deref(),
        socket_path.as_deref(),
        &target,
        enabled,
    );
    let op = build_remote_tmux_op(
        &host,
        user.as_deref(),
        port,
        ssh_config_alias.as_deref(),
        key_path.as_deref(),
        proxy_jump.as_deref(),
        identity_agent.as_deref(),
        remote,
        skip_host_key_check.unwrap_or(false),
    );
    match run_remote_tmux_command(op).await {
        Ok(()) => Ok(()),
        Err(e) if e.contains("unknown option") || e.contains("bad option") || e.contains("mouse") => {
            // Fallback to legacy mouse options for tmux < 2.1
            let legacy_cmds = build_set_mouse_legacy(
                tmux_binary.as_deref(),
                socket_path.as_deref(),
                &target,
                enabled,
            );
            for cmd in legacy_cmds {
                let op_legacy = build_remote_tmux_op(
                    &host,
                    user.as_deref(),
                    port,
                    ssh_config_alias.as_deref(),
                    key_path.as_deref(),
                    proxy_jump.as_deref(),
                    identity_agent.as_deref(),
                    cmd,
                    skip_host_key_check.unwrap_or(false),
                );
                let _ = run_remote_tmux_command(op_legacy).await;
            }
            Ok(())
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
async fn tmux_new_remote_window(
    host: String,
    user: Option<String>,
    port: Option<u16>,
    ssh_config_alias: Option<String>,
    key_path: Option<String>,
    proxy_jump: Option<String>,
    identity_agent: Option<String>,
    target: String,
    tmux_binary: Option<String>,
    socket_path: Option<String>,
    skip_host_key_check: Option<bool>,
) -> Result<(), String> {
    let remote = build_new_window(tmux_binary.as_deref(), socket_path.as_deref(), &target);
    run_remote_tmux_command(build_remote_tmux_op(
        &host,
        user.as_deref(),
        port,
        ssh_config_alias.as_deref(),
        key_path.as_deref(),
        proxy_jump.as_deref(),
        identity_agent.as_deref(),
        remote,
        skip_host_key_check.unwrap_or(false),
    ))
    .await
}

#[tauri::command]
async fn tmux_kill_remote_window(
    host: String,
    user: Option<String>,
    port: Option<u16>,
    ssh_config_alias: Option<String>,
    key_path: Option<String>,
    proxy_jump: Option<String>,
    identity_agent: Option<String>,
    target: String,
    tmux_binary: Option<String>,
    socket_path: Option<String>,
    skip_host_key_check: Option<bool>,
) -> Result<(), String> {
    let remote = build_kill_window(tmux_binary.as_deref(), socket_path.as_deref(), &target);
    run_remote_tmux_command(build_remote_tmux_op(
        &host,
        user.as_deref(),
        port,
        ssh_config_alias.as_deref(),
        key_path.as_deref(),
        proxy_jump.as_deref(),
        identity_agent.as_deref(),
        remote,
        skip_host_key_check.unwrap_or(false),
    ))
    .await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteEnvProbe {
    lang: Option<String>,
    lc_ctype: Option<String>,
    tmux_present: bool,
    tmux_version: Option<TmuxVersion>,
    utf8_ok: bool,
}

#[tauri::command]
async fn probe_remote_env(
    host: String,
    user: Option<String>,
    port: Option<u16>,
    ssh_config_alias: Option<String>,
    key_path: Option<String>,
    proxy_jump: Option<String>,
    identity_agent: Option<String>,
    skip_host_key_check: Option<bool>,
) -> Result<RemoteEnvProbe, String> {
    let argv = build_ssh_probe_argv(
        &SshLaunchArgs {
            user: opt_non_empty(user.as_deref()),
            host: host.trim(),
            port,
            ssh_config_alias: opt_non_empty(ssh_config_alias.as_deref()),
            key_path: opt_non_empty(key_path.as_deref()),
            proxy_jump: opt_non_empty(proxy_jump.as_deref()),
            identity_agent: opt_non_empty(identity_agent.as_deref()),
            tmux_session: None,
            tmux_window: None,
            skip_host_key_check: skip_host_key_check.unwrap_or(false),
            password_auth: false,
        },
        &["sh".to_string(), "-lc".to_string(), "printf 'LANG=%s\\nLC_CTYPE=%s\\n' \"$LANG\" \"$LC_CTYPE\"; command -v tmux >/dev/null 2>&1 && tmux -V || echo 'TMUX_MISSING'".into()],
        true,
    );

    let output = tokio::process::Command::new(&argv[0])
        .args(&argv[1..])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "remote probe failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let body = String::from_utf8_lossy(&output.stdout).to_string();
    let mut lang = None;
    let mut lc_ctype = None;
    let mut tmux_version: Option<TmuxVersion> = None;
    let mut tmux_present = false;
    for line in body.lines() {
        if let Some(rest) = line.strip_prefix("LANG=") {
            lang = Some(rest.to_string());
        } else if let Some(rest) = line.strip_prefix("LC_CTYPE=") {
            lc_ctype = Some(rest.to_string());
        } else if line == "TMUX_MISSING" {
            tmux_present = false;
        } else if line.starts_with("tmux ") {
            tmux_present = true;
            tmux_version = tmux::parse(line);
        }
    }
    let utf8_ok = is_utf8(lang.as_deref()) || is_utf8(lc_ctype.as_deref());
    Ok(RemoteEnvProbe {
        lang,
        lc_ctype,
        tmux_present,
        tmux_version,
        utf8_ok,
    })
}

fn is_utf8(s: Option<&str>) -> bool {
    match s {
        Some(v) => {
            let lower = v.to_ascii_lowercase();
            lower.contains("utf-8") || lower.contains("utf8")
        }
        None => false,
    }
}

#[tauri::command]
async fn config_load() -> Result<AppConfig, String> {
    config::load().map_err(|e| e.to_string())
}

#[tauri::command]
async fn config_save(app: AppHandle, payload: AppConfig) -> Result<(), String> {
    config::save(&payload).map_err(|e| e.to_string())?;
    app.emit("remux:config-changed", &payload).ok();
    Ok(())
}

#[tauri::command]
async fn open_new_window(app: AppHandle) -> Result<String, String> {
    spawn_window(&app).map_err(|e| e.to_string())
}

#[tauri::command]
async fn ssh_config_list_hosts() -> Result<Vec<String>, String> {
    ssh_config::list_hosts()
}

#[tauri::command]
async fn ssh_config_resolve_host(alias: String) -> Result<ssh_config::SshConfigHost, String> {
    ssh_config::resolve_host(alias)
}

#[tauri::command]
async fn secrets_set(service: String, account: String, secret: String) -> Result<(), String> {
    keyring_bridge::set_secret(&service, &account, &secret)
}

#[tauri::command]
async fn secrets_get(service: String, account: String) -> Result<Option<String>, String> {
    keyring_bridge::get_secret(&service, &account)
}

#[tauri::command]
async fn secrets_delete(service: String, account: String) -> Result<(), String> {
    keyring_bridge::delete_secret(&service, &account)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TestConnectionResult {
    ok: bool,
    rtt_ms: u32,
    detail: String,
}

#[tauri::command]
async fn test_connection(
    host: String,
    user: Option<String>,
    port: Option<u16>,
    ssh_config_alias: Option<String>,
    key_path: Option<String>,
    proxy_jump: Option<String>,
    identity_agent: Option<String>,
    skip_host_key_check: Option<bool>,
) -> Result<TestConnectionResult, String> {
    let argv = build_ssh_probe_argv(
        &SshLaunchArgs {
            user: opt_non_empty(user.as_deref()),
            host: host.trim(),
            port,
            ssh_config_alias: opt_non_empty(ssh_config_alias.as_deref()),
            key_path: opt_non_empty(key_path.as_deref()),
            proxy_jump: opt_non_empty(proxy_jump.as_deref()),
            identity_agent: opt_non_empty(identity_agent.as_deref()),
            tmux_session: None,
            tmux_window: None,
            skip_host_key_check: skip_host_key_check.unwrap_or(false),
            password_auth: false,
        },
        &["true".to_string()],
        true,
    );

    let start = std::time::Instant::now();
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(8),
        tokio::process::Command::new(&argv[0])
            .args(&argv[1..])
            .output(),
    )
    .await
    .map_err(|_| "ssh probe timed out".to_string())?
    .map_err(|e| e.to_string())?;
    let rtt_ms = start.elapsed().as_millis().min(u32::MAX as u128) as u32;

    if output.status.success() {
        return Ok(TestConnectionResult {
            ok: true,
            rtt_ms,
            detail: "Reachable. Non-interactive auth succeeded.".into(),
        });
    }

    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let lower = stderr.to_ascii_lowercase();
    let detail = if lower.contains("permission denied") {
        "Reachable. Authentication required (interactive prompt expected at launch).".to_string()
    } else if lower.contains("connection refused")
        || lower.contains("could not resolve")
        || lower.contains("no route to host")
        || lower.contains("timed out")
    {
        format!("Unreachable: {}", stderr.trim())
    } else {
        format!("Probe failed: {}", stderr.trim())
    };
    let auth_only_failure = lower.contains("permission denied");
    Ok(TestConnectionResult {
        ok: auth_only_failure,
        rtt_ms,
        detail,
    })
}

#[tauri::command]
async fn tmux_probe_hierarchy(
    host: Option<String>,
    user: Option<String>,
    port: Option<u16>,
    ssh_config_alias: Option<String>,
    key_path: Option<String>,
    proxy_jump: Option<String>,
    identity_agent: Option<String>,
    tmux_binary: Option<String>,
    socket_path: Option<String>,
    skip_host_key_check: Option<bool>,
) -> Result<Vec<TmuxSessionNode>, String> {
    let panes = if let Some(h) = host {
        tmux_list_remote_panes(
            h,
            user,
            port,
            ssh_config_alias,
            key_path,
            proxy_jump,
            identity_agent,
            tmux_binary,
            socket_path,
            skip_host_key_check,
        )
        .await?
    } else {
        tmux_list_local_panes(tmux_binary, socket_path).await?
    };
    Ok(build_hierarchy(panes))
}

#[tauri::command]
async fn get_process_memory(
    pid: u32,
    host: Option<String>,
    user: Option<String>,
    port: Option<u16>,
    ssh_config_alias: Option<String>,
    key_path: Option<String>,
    proxy_jump: Option<String>,
    identity_agent: Option<String>,
    skip_host_key_check: Option<bool>,
) -> Result<u64, String> {
    let cmd = format!("ps -o rss= -p {pid}");
    let output = if let Some(ref h) = host {
        let argv = build_ssh_remote_command_argv(
            &SshLaunchArgs {
                user: opt_non_empty(user.as_deref()),
                host: h.trim(),
                port,
                ssh_config_alias: opt_non_empty(ssh_config_alias.as_deref()),
                key_path: opt_non_empty(key_path.as_deref()),
                proxy_jump: opt_non_empty(proxy_jump.as_deref()),
                identity_agent: opt_non_empty(identity_agent.as_deref()),
                tmux_session: None,
                tmux_window: None,
                skip_host_key_check: skip_host_key_check.unwrap_or(false),
                password_auth: false,
            },
            &["sh".to_string(), "-c".to_string(), cmd],
            true,
        );
        tokio::process::Command::new(&argv[0])
            .args(&argv[1..])
            .output()
            .await
            .map_err(|e| e.to_string())?
    } else {
        tokio::process::Command::new("sh")
            .arg("-c")
            .arg(&cmd)
            .output()
            .await
            .map_err(|e| e.to_string())?
    };

    if !output.status.success() {
        return Err("Failed to execute ps command".to_string());
    }

    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let kb = stdout_str.trim().parse::<u64>().map_err(|e| e.to_string())?;
    Ok(kb)
}

fn spawn_window(app: &AppHandle) -> tauri::Result<String> {
    let label = format!("main-{}", Uuid::new_v4().simple());
    WebviewWindowBuilder::new(app, &label, WebviewUrl::default())
        .title("REMUX")
        .inner_size(1280.0, 800.0)
        .min_inner_size(900.0, 560.0)
        .build()?;
    Ok(label)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Err(e) = spawn_window(app) {
                log::error!("failed to spawn additional window: {e}");
            }
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState {
            pty: Arc::new(PtyManager::new()),
        })
        .invoke_handler(tauri::generate_handler![
            pty_spawn_local,
            pty_spawn_tmux_local,
            pty_spawn_ssh_tmux,
            pty_write,
            pty_resize,
            pty_kill,
            tmux_local_version,
            tmux_list_local_panes,
            tmux_list_remote_panes,
            tmux_split_local_pane,
            tmux_kill_local_pane,
            tmux_select_local_pane,
            tmux_zoom_local_pane,
            tmux_select_local_layout,
            tmux_rename_local_window,
            tmux_rename_local_pane,
            tmux_set_local_mouse,
            tmux_new_local_window,
            tmux_kill_local_window,
            tmux_split_remote_pane,
            tmux_kill_remote_pane,
            tmux_zoom_remote_pane,
            tmux_select_remote_pane,
            tmux_rename_remote_window,
            tmux_select_remote_layout,
            tmux_rename_remote_pane,
            tmux_set_remote_mouse,
            tmux_new_remote_window,
            tmux_kill_remote_window,
            probe_remote_env,
            config_load,
            config_save,
            open_new_window,
            ssh_config_list_hosts,
            ssh_config_resolve_host,
            secrets_set,
            secrets_get,
            secrets_delete,
            test_connection,
            tmux_probe_hierarchy,
            get_process_memory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
