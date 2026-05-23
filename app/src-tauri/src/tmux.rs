use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TmuxVersion {
    pub raw: String,
    pub major: u32,
    pub minor: u32,
    pub modern_mouse: bool,
    pub supports_user_options: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TmuxPaneIdentity {
    pub pane_id: String,
    pub window_id: String,
    pub session_id: String,
    pub session_name: String,
    pub window_index: u32,
    pub window_name: String,
    pub window_layout: Option<String>,
    pub pane_index: u32,
    pub pane_title: Option<String>,
    pub pane_pid: Option<u32>,
    pub pane_current_command: Option<String>,
    pub pane_current_path: Option<String>,
}

// tmux 3.6 replaces any control character (\t, \x1f, etc.) in -F format
// output with '_' before printing, so the separator must be a printable
// character. '|' is safe because tmux session names are validated to
// disallow it and pane fields (ids, indices, hostname-based titles,
// current cwd, command names) never legitimately contain pipes.
pub const PANE_LIST_FIELD_SEPARATOR: char = '|';
pub const PANE_LIST_FORMAT: &str = "#{pane_id}|#{window_id}|#{session_id}|#{session_name}|#{window_index}|#{window_name}|#{window_layout}|#{pane_index}|#{pane_title}|#{pane_pid}|#{pane_current_command}|#{pane_current_path}";

pub fn resolve_tmux_path(binary: Option<&str>) -> String {
    let bin = binary.unwrap_or("tmux");
    if cfg!(test) {
        return bin.to_string();
    }
    if bin == "tmux" {
        #[cfg(target_os = "macos")]
        {
            let paths = [
                "/opt/homebrew/bin/tmux",
                "/usr/local/bin/tmux",
                "/usr/bin/tmux",
                "/bin/tmux",
            ];
            for p in &paths {
                if std::path::Path::new(p).is_file() {
                    return p.to_string();
                }
            }
        }
    }
    bin.to_string()
}

pub fn detect_local_version(binary: Option<&str>) -> Option<TmuxVersion> {
    let bin = resolve_tmux_path(binary);
    let mut cmd = Command::new(&bin);
    cmd.arg("-V");
    crate::hide_window(&mut cmd);
    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    parse(&raw)
}

pub fn parse(raw: &str) -> Option<TmuxVersion> {
    let mut iter = raw.split_whitespace();
    let _label = iter.next()?;
    let version = iter.next()?;
    let mut nums = version.split('.');
    let major: u32 = nums.next()?.parse().ok()?;
    let minor_raw = nums.next().unwrap_or("0");
    let minor: u32 = minor_raw
        .trim_end_matches(|c: char| !c.is_ascii_digit())
        .parse()
        .unwrap_or(0);
    let modern_mouse = major > 2 || (major == 2 && minor >= 1);
    let supports_user_options = major >= 3;
    Some(TmuxVersion {
        raw: raw.to_string(),
        major,
        minor,
        modern_mouse,
        supports_user_options,
    })
}

#[derive(Debug, Clone)]
pub struct AttachArgs<'a> {
    pub binary: Option<&'a str>,
    pub socket_path: Option<&'a str>,
    pub session: &'a str,
    pub detach_others: bool,
    pub window: Option<&'a str>,
    pub mouse_mode: bool,
}

pub fn build_attach_or_create(args: &AttachArgs<'_>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    out.push(resolve_tmux_path(args.binary));
    if let Some(sock) = args.socket_path {
        out.push("-S".into());
        out.push(sock.into());
    }
    out.push("new-session".into());
    out.push("-A".into());
    if args.detach_others {
        out.push("-D".into());
    }
    out.push("-s".into());
    out.push(args.session.into());
    if let Some(w) = args.window {
        out.push("-n".into());
        out.push(w.into());
    }
    // Chain a server-side option toggle that scopes mouse mode to this
    // session, so REMUX can dynamically enable/disable it.
    out.push(";".into());
    out.push("set-option".into());
    out.push("-t".into());
    out.push(args.session.into());
    out.push("mouse".into());
    out.push(if args.mouse_mode { "on" } else { "off" }.into());
    out
}

pub fn build_list_panes(args: &AttachArgs<'_>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    out.push(resolve_tmux_path(args.binary));
    if let Some(sock) = args.socket_path {
        out.push("-S".into());
        out.push(sock.into());
    }
    out.push("list-panes".into());
    out.push("-a".into());
    out.push("-F".into());
    out.push(PANE_LIST_FORMAT.into());
    out
}

pub fn with_tmux_prefix(
    binary: Option<&str>,
    socket_path: Option<&str>,
    command: &[&str],
) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    out.push(resolve_tmux_path(binary));
    if let Some(sock) = socket_path {
        out.push("-S".into());
        out.push(sock.into());
    }
    out.extend(command.iter().map(|part| (*part).to_string()));
    out
}

pub fn build_split_pane(
    binary: Option<&str>,
    socket_path: Option<&str>,
    target: &str,
    direction: &str,
) -> Result<Vec<String>, String> {
    let flag = match direction {
        "right" | "horizontal" | "column" => "-h",
        "down" | "vertical" | "row" => "-v",
        _ => return Err(format!("unsupported split direction: {direction}")),
    };
    Ok(with_tmux_prefix(
        binary,
        socket_path,
        &["split-window", flag, "-t", target],
    ))
}

pub fn build_kill_pane(binary: Option<&str>, socket_path: Option<&str>, target: &str) -> Vec<String> {
    with_tmux_prefix(binary, socket_path, &["kill-pane", "-t", target])
}

pub fn build_select_pane(binary: Option<&str>, socket_path: Option<&str>, target: &str) -> Vec<String> {
    with_tmux_prefix(binary, socket_path, &["select-pane", "-t", target])
}

pub fn build_zoom_pane(binary: Option<&str>, socket_path: Option<&str>, target: &str) -> Vec<String> {
    with_tmux_prefix(binary, socket_path, &["resize-pane", "-Z", "-t", target])
}

pub fn build_select_layout(
    binary: Option<&str>,
    socket_path: Option<&str>,
    target: &str,
    preset: &str,
) -> Result<Vec<String>, String> {
    let layout = match preset {
        "even" | "tiled" => "tiled",
        "main-left" | "main-vertical" => "main-vertical",
        "main-top" | "main-horizontal" => "main-horizontal",
        _ => return Err(format!("unsupported layout preset: {preset}")),
    };
    Ok(with_tmux_prefix(
        binary,
        socket_path,
        &["select-layout", "-t", target, layout],
    ))
}

pub fn build_rename_window(
    binary: Option<&str>,
    socket_path: Option<&str>,
    target: &str,
    name: &str,
) -> Vec<String> {
    with_tmux_prefix(binary, socket_path, &["rename-window", "-t", target, name])
}

pub fn build_rename_pane(
    binary: Option<&str>,
    socket_path: Option<&str>,
    target: &str,
    title: &str,
) -> Vec<String> {
    with_tmux_prefix(binary, socket_path, &["select-pane", "-t", target, "-T", title])
}

pub fn build_set_mouse(
    binary: Option<&str>,
    socket_path: Option<&str>,
    target: &str,
    enabled: bool,
) -> Vec<String> {
    with_tmux_prefix(
        binary,
        socket_path,
        &[
            "set-option",
            "-t",
            target,
            "mouse",
            if enabled { "on" } else { "off" },
        ],
    )
}

pub fn build_set_mouse_legacy(
    binary: Option<&str>,
    socket_path: Option<&str>,
    target: &str,
    enabled: bool,
) -> Vec<Vec<String>> {
    let val = if enabled { "on" } else { "off" };
    let opts = [
        "mode-mouse",
        "mouse-select-pane",
        "mouse-select-window",
        "mouse-resize-pane",
    ];
    opts.iter()
        .map(|opt| {
            with_tmux_prefix(
                binary,
                socket_path,
                &["set-option", "-t", target, opt, val],
            )
        })
        .collect()
}

pub fn build_new_window(
    binary: Option<&str>,
    socket_path: Option<&str>,
    target_session: &str,
) -> Vec<String> {
    with_tmux_prefix(binary, socket_path, &["new-window", "-t", target_session])
}

pub fn build_kill_window(
    binary: Option<&str>,
    socket_path: Option<&str>,
    target_window: &str,
) -> Vec<String> {
    with_tmux_prefix(binary, socket_path, &["kill-window", "-t", target_window])
}


pub fn parse_pane_row(row: &str) -> Option<TmuxPaneIdentity> {
    let parts: Vec<&str> = row.split(PANE_LIST_FIELD_SEPARATOR).collect();
    if parts.len() < 11 {
        return None;
    }
    let has_window_layout = parts.len() >= 12;
    let pane_index_idx = if has_window_layout { 7 } else { 6 };
    let pane_title_idx = if has_window_layout { 8 } else { 7 };
    let pane_pid_idx = if has_window_layout { 9 } else { 8 };
    let pane_command_idx = if has_window_layout { 10 } else { 9 };
    let pane_path_idx = if has_window_layout { 11 } else { 10 };
    Some(TmuxPaneIdentity {
        pane_id: parts[0].to_string(),
        window_id: parts[1].to_string(),
        session_id: parts[2].to_string(),
        session_name: parts[3].to_string(),
        window_index: parts[4].parse().ok()?,
        window_name: parts[5].to_string(),
        window_layout: if has_window_layout { non_empty(parts[6]) } else { None },
        pane_index: parts[pane_index_idx].parse().ok()?,
        pane_title: non_empty(parts[pane_title_idx]),
        pane_pid: parts[pane_pid_idx].parse().ok(),
        pane_current_command: non_empty(parts[pane_command_idx]),
        pane_current_path: non_empty(parts[pane_path_idx]),
    })
}

pub fn list_local_panes(
    binary: Option<&str>,
    socket_path: Option<&str>,
) -> Result<Vec<TmuxPaneIdentity>, String> {
    let argv = build_list_panes(&AttachArgs {
        binary,
        socket_path,
        session: "",
        detach_others: false,
        window: None,
        mouse_mode: false,
    });
    let mut cmd = Command::new(&argv[0]);
    cmd.args(&argv[1..]);
    crate::hide_window(&mut cmd);
    let output = cmd.output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let body = String::from_utf8_lossy(&output.stdout);
    Ok(body.lines().filter_map(parse_pane_row).collect())
}

fn non_empty(value: &str) -> Option<String> {
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxSessionNode {
    pub session_id: String,
    pub session_name: String,
    pub windows: Vec<TmuxWindowNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxWindowNode {
    pub window_id: String,
    pub window_name: String,
    pub window_index: u32,
    pub window_layout: Option<String>,
    pub panes: Vec<TmuxPaneNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxPaneNode {
    pub pane_id: String,
    pub pane_index: u32,
    pub pane_title: Option<String>,
    pub pane_pid: Option<u32>,
    pub pane_current_command: Option<String>,
    pub pane_current_path: Option<String>,
}

pub fn build_hierarchy(panes: Vec<TmuxPaneIdentity>) -> Vec<TmuxSessionNode> {
    let mut sessions: Vec<TmuxSessionNode> = Vec::new();

    for p in panes {
        // Find or create session
        let session_idx = if let Some(idx) = sessions.iter().position(|s| s.session_id == p.session_id) {
            idx
        } else {
            sessions.push(TmuxSessionNode {
                session_id: p.session_id.clone(),
                session_name: p.session_name.clone(),
                windows: Vec::new(),
            });
            sessions.len() - 1
        };
        let session = &mut sessions[session_idx];

        // Find or create window
        let window_idx = if let Some(idx) = session.windows.iter().position(|w| w.window_id == p.window_id) {
            idx
        } else {
            session.windows.push(TmuxWindowNode {
                window_id: p.window_id.clone(),
                window_name: p.window_name.clone(),
                window_index: p.window_index,
                window_layout: p.window_layout.clone(),
                panes: Vec::new(),
            });
            session.windows.sort_by_key(|w| w.window_index);
            session.windows.iter().position(|w| w.window_id == p.window_id).unwrap()
        };
        let window = &mut session.windows[window_idx];
        if window.window_layout.is_none() {
            window.window_layout = p.window_layout.clone();
        }

        // Add pane
        if !window.panes.iter().any(|pn| pn.pane_id == p.pane_id) {
            window.panes.push(TmuxPaneNode {
                pane_id: p.pane_id.clone(),
                pane_index: p.pane_index,
                pane_title: p.pane_title.clone(),
                pane_pid: p.pane_pid,
                pane_current_command: p.pane_current_command.clone(),
                pane_current_path: p.pane_current_path.clone(),
            });
            window.panes.sort_by_key(|pn| pn.pane_index);
        }
    }

    sessions
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_modern() {
        let v = parse("tmux 3.5a").unwrap();
        assert_eq!(v.major, 3);
        assert_eq!(v.minor, 5);
        assert!(v.modern_mouse);
        assert!(v.supports_user_options);
    }

    #[test]
    fn parses_legacy() {
        let v = parse("tmux 2.0").unwrap();
        assert_eq!(v.major, 2);
        assert_eq!(v.minor, 0);
        assert!(!v.modern_mouse);
        assert!(!v.supports_user_options);
    }

    #[test]
    fn builds_attach_basic() {
        let cmd = build_attach_or_create(&AttachArgs {
            binary: None,
            socket_path: None,
            session: "remux-dev",
            detach_others: false,
            window: None,
            mouse_mode: false,
        });
        assert_eq!(
            cmd,
            vec![
                "tmux",
                "new-session",
                "-A",
                "-s",
                "remux-dev",
                ";",
                "set-option",
                "-t",
                "remux-dev",
                "mouse",
                "off",
            ]
        );
    }

    #[test]
    fn builds_attach_mouse_on() {
        let cmd = build_attach_or_create(&AttachArgs {
            binary: None,
            socket_path: None,
            session: "remux-dev",
            detach_others: false,
            window: None,
            mouse_mode: true,
        });
        assert_eq!(
            cmd,
            vec![
                "tmux",
                "new-session",
                "-A",
                "-s",
                "remux-dev",
                ";",
                "set-option",
                "-t",
                "remux-dev",
                "mouse",
                "on",
            ]
        );
    }

    #[test]
    fn builds_attach_detach_others() {
        let cmd = build_attach_or_create(&AttachArgs {
            binary: Some("/opt/homebrew/bin/tmux"),
            socket_path: Some("/tmp/tmux-501/default"),
            session: "logs",
            detach_others: true,
            window: Some("api"),
            mouse_mode: false,
        });
        assert_eq!(
            cmd,
            vec![
                "/opt/homebrew/bin/tmux",
                "-S",
                "/tmp/tmux-501/default",
                "new-session",
                "-A",
                "-D",
                "-s",
                "logs",
                "-n",
                "api",
                ";",
                "set-option",
                "-t",
                "logs",
                "mouse",
                "off",
            ]
        );
    }

    #[test]
    fn builds_list_panes_with_socket() {
        let cmd = build_list_panes(&AttachArgs {
            binary: Some("/opt/homebrew/bin/tmux"),
            socket_path: Some("/tmp/tmux/default"),
            session: "ignored",
            detach_others: false,
            window: None,
            mouse_mode: false,
        });
        assert_eq!(
            cmd,
            vec![
                "/opt/homebrew/bin/tmux",
                "-S",
                "/tmp/tmux/default",
                "list-panes",
                "-a",
                "-F",
                PANE_LIST_FORMAT,
            ]
        );
    }

    #[test]
    fn parses_pane_row() {
        let row = "%3|@1|$0|remux|2|api|bb62,120x40,0,0{60x40,0,0,1,59x40,61,0,3}|1|vim|12345|nvim|/Users/storysq/REMUX";
        let pane = parse_pane_row(row).unwrap();
        assert_eq!(pane.pane_id, "%3");
        assert_eq!(pane.window_id, "@1");
        assert_eq!(pane.session_name, "remux");
        assert_eq!(pane.window_index, 2);
        assert_eq!(pane.window_name, "api");
        assert_eq!(
            pane.window_layout.as_deref(),
            Some("bb62,120x40,0,0{60x40,0,0,1,59x40,61,0,3}")
        );
        assert_eq!(pane.pane_index, 1);
        assert_eq!(pane.pane_title.as_deref(), Some("vim"));
        assert_eq!(pane.pane_pid, Some(12345));
        assert_eq!(pane.pane_current_command.as_deref(), Some("nvim"));
        assert_eq!(pane.pane_current_path.as_deref(), Some("/Users/storysq/REMUX"));
    }

    #[test]
    fn parses_legacy_pane_row_without_window_layout() {
        let row = "%3|@1|$0|remux|2|api|1|vim|12345|nvim|/Users/storysq/REMUX";
        let pane = parse_pane_row(row).unwrap();
        assert_eq!(pane.window_layout, None);
        assert_eq!(pane.pane_index, 1);
        assert_eq!(pane.pane_title.as_deref(), Some("vim"));
    }

    #[test]
    fn builds_native_pane_operations() {
        assert_eq!(
            build_split_pane(None, None, "%3", "column").unwrap(),
            vec!["tmux", "split-window", "-h", "-t", "%3"]
        );
        assert_eq!(
            build_split_pane(Some("/opt/tmux"), Some("/tmp/sock"), "%3", "row").unwrap(),
            vec!["/opt/tmux", "-S", "/tmp/sock", "split-window", "-v", "-t", "%3"]
        );
        assert!(build_split_pane(None, None, "%3", "diagonal").is_err());
        assert_eq!(build_kill_pane(None, None, "%3"), vec!["tmux", "kill-pane", "-t", "%3"]);
        assert_eq!(build_select_pane(None, None, "%3"), vec!["tmux", "select-pane", "-t", "%3"]);
        assert_eq!(build_zoom_pane(None, None, "%3"), vec!["tmux", "resize-pane", "-Z", "-t", "%3"]);
        assert_eq!(
            build_select_layout(None, None, "@2", "even").unwrap(),
            vec!["tmux", "select-layout", "-t", "@2", "tiled"]
        );
        assert_eq!(
            build_select_layout(Some("tmux"), Some("/tmp/sock"), "@2", "main-left").unwrap(),
            vec!["tmux", "-S", "/tmp/sock", "select-layout", "-t", "@2", "main-vertical"]
        );
        assert_eq!(
            build_select_layout(None, None, "@2", "main-top").unwrap(),
            vec!["tmux", "select-layout", "-t", "@2", "main-horizontal"]
        );
        assert!(build_select_layout(None, None, "@2", "spiral").is_err());
        assert_eq!(
            build_rename_window(None, None, "remux:1", "server logs"),
            vec!["tmux", "rename-window", "-t", "remux:1", "server logs"]
        );
        assert_eq!(
            build_rename_pane(None, None, "%3", "worker"),
            vec!["tmux", "select-pane", "-t", "%3", "-T", "worker"]
        );
        assert_eq!(
            build_set_mouse(Some("tmux"), Some("/tmp/sock"), "remux", true),
            vec![
                "tmux",
                "-S",
                "/tmp/sock",
                "set-option",
                "-t",
                "remux",
                "mouse",
                "on"
            ]
        );
    }

    #[test]
    fn test_build_hierarchy() {
        let panes = vec![
            TmuxPaneIdentity {
                pane_id: "%1".to_string(),
                window_id: "@1".to_string(),
                session_id: "$1".to_string(),
                session_name: "dev".to_string(),
                window_index: 0,
                window_name: "sh".to_string(),
                window_layout: Some("layout-a".to_string()),
                pane_index: 0,
                pane_title: None,
                pane_pid: Some(101),
                pane_current_command: Some("zsh".to_string()),
                pane_current_path: Some("/tmp".to_string()),
            },
            TmuxPaneIdentity {
                pane_id: "%2".to_string(),
                window_id: "@1".to_string(),
                session_id: "$1".to_string(),
                session_name: "dev".to_string(),
                window_index: 0,
                window_name: "sh".to_string(),
                window_layout: Some("layout-a".to_string()),
                pane_index: 1,
                pane_title: None,
                pane_pid: Some(102),
                pane_current_command: Some("vim".to_string()),
                pane_current_path: Some("/tmp".to_string()),
            },
            TmuxPaneIdentity {
                pane_id: "%3".to_string(),
                window_id: "@2".to_string(),
                session_id: "$1".to_string(),
                session_name: "dev".to_string(),
                window_index: 1,
                window_name: "db".to_string(),
                window_layout: Some("layout-b".to_string()),
                pane_index: 0,
                pane_title: None,
                pane_pid: Some(103),
                pane_current_command: Some("psql".to_string()),
                pane_current_path: Some("/var".to_string()),
            },
        ];

        let hierarchy = build_hierarchy(panes);
        assert_eq!(hierarchy.len(), 1);
        assert_eq!(hierarchy[0].session_name, "dev");
        assert_eq!(hierarchy[0].windows.len(), 2);
        assert_eq!(hierarchy[0].windows[0].window_name, "sh");
        assert_eq!(hierarchy[0].windows[0].window_layout.as_deref(), Some("layout-a"));
        assert_eq!(hierarchy[0].windows[0].panes.len(), 2);
        assert_eq!(hierarchy[0].windows[0].panes[0].pane_id, "%1");
        assert_eq!(hierarchy[0].windows[0].panes[1].pane_id, "%2");
        assert_eq!(hierarchy[0].windows[1].window_name, "db");
        assert_eq!(hierarchy[0].windows[1].panes.len(), 1);
        assert_eq!(hierarchy[0].windows[1].panes[0].pane_id, "%3");
    }

    #[test]
    fn builds_new_and_kill_window() {
        let cmd_new = build_new_window(None, None, "my_session");
        assert_eq!(cmd_new, vec!["tmux", "new-window", "-t", "my_session"]);

        let cmd_kill = build_kill_window(None, None, "my_session:1");
        assert_eq!(cmd_kill, vec!["tmux", "kill-window", "-t", "my_session:1"]);
    }

    #[test]
    fn builds_legacy_mouse() {
        let cmds = build_set_mouse_legacy(None, None, "dev", true);
        assert_eq!(cmds.len(), 4);
        assert_eq!(cmds[0], vec!["tmux", "set-option", "-t", "dev", "mode-mouse", "on"]);
        assert_eq!(cmds[1], vec!["tmux", "set-option", "-t", "dev", "mouse-select-pane", "on"]);
        assert_eq!(cmds[2], vec!["tmux", "set-option", "-t", "dev", "mouse-select-window", "on"]);
        assert_eq!(cmds[3], vec!["tmux", "set-option", "-t", "dev", "mouse-resize-pane", "on"]);
    }
}
