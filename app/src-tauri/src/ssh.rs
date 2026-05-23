use crate::tmux;

pub struct SshLaunchArgs<'a> {
    pub user: Option<&'a str>,
    pub host: &'a str,
    pub port: Option<u16>,
    pub ssh_config_alias: Option<&'a str>,
    pub key_path: Option<&'a str>,
    pub proxy_jump: Option<&'a str>,
    pub identity_agent: Option<&'a str>,
    pub tmux_session: Option<&'a str>,
    pub tmux_window: Option<&'a str>,
    pub skip_host_key_check: bool,
    pub password_auth: bool,
    pub detach_others: bool,
    pub mouse_mode: bool,
}

pub fn build_ssh_argv(args: &SshLaunchArgs<'_>) -> Vec<String> {
    let mut argv = build_ssh_base_argv(args, true, false);
    if let Some(session) = args.tmux_session {
        let remote = tmux::build_attach_or_create(&tmux::AttachArgs {
            binary: None,
            socket_path: None,
            session,
            detach_others: args.detach_others,
            window: args.tmux_window,
            mouse_mode: args.mouse_mode,
        });
        let remote_cmd = shell_escape(&remote);
        argv.push(remote_cmd);
    }
    argv
}

pub fn build_ssh_remote_command_argv(
    args: &SshLaunchArgs<'_>,
    remote_command: &[String],
    batch_mode: bool,
) -> Vec<String> {
    let mut argv = build_ssh_base_argv(args, false, batch_mode);
    argv.push(shell_escape(remote_command));
    argv
}

pub fn build_ssh_probe_argv(
    args: &SshLaunchArgs<'_>,
    remote_command: &[String],
    discard_known_hosts: bool,
) -> Vec<String> {
    let mut argv = build_ssh_base_options(args, false, true);
    if discard_known_hosts {
        argv.push("-o".into());
        argv.push("StrictHostKeyChecking=no".into());
        argv.push("-o".into());
        argv.push("UserKnownHostsFile=/dev/null".into());
    }
    argv.push(ssh_target(args));
    argv.push(shell_escape(remote_command));
    argv
}

fn build_ssh_base_argv(
    args: &SshLaunchArgs<'_>,
    allocate_tty: bool,
    batch_mode: bool,
) -> Vec<String> {
    let mut argv = build_ssh_base_options(args, allocate_tty, batch_mode);
    argv.push(ssh_target(args));
    argv
}

fn build_ssh_base_options(
    args: &SshLaunchArgs<'_>,
    allocate_tty: bool,
    batch_mode: bool,
) -> Vec<String> {
    let mut argv: Vec<String> = vec!["ssh".into()];
    if allocate_tty {
        argv.push("-t".into());
    }
    if allocate_tty {
        argv.push("-o".into());
        argv.push("ServerAliveInterval=5".into());
        argv.push("-o".into());
        argv.push("ServerAliveCountMax=2".into());
    }
    if batch_mode {
        argv.push("-o".into());
        argv.push("BatchMode=yes".into());
        argv.push("-o".into());
        argv.push("ConnectTimeout=5".into());
    }
    if args.skip_host_key_check {
        argv.push("-o".into());
        argv.push("StrictHostKeyChecking=no".into());
        argv.push("-o".into());
        argv.push("UserKnownHostsFile=/dev/null".into());
    }
    if args.password_auth {
        argv.push("-o".into());
        argv.push("PreferredAuthentications=password".into());
    }
    if let Some(port) = args.port {
        if port != 22 {
            argv.push("-p".into());
            argv.push(port.to_string());
        }
    }
    if let Some(key_path) = args.key_path {
        argv.push("-i".into());
        argv.push(key_path.to_string());
    }
    if let Some(proxy_jump) = args.proxy_jump {
        argv.push("-J".into());
        argv.push(proxy_jump.to_string());
    }
    if let Some(identity_agent) = args.identity_agent {
        argv.push("-o".into());
        argv.push(format!("IdentityAgent={identity_agent}"));
    }
    argv
}

fn ssh_target(args: &SshLaunchArgs<'_>) -> String {
    if let Some(alias) = args.ssh_config_alias {
        alias.to_string()
    } else if let Some(user) = args.user {
        format!("{user}@{}", args.host)
    } else {
        args.host.to_string()
    }
}

pub fn shell_escape(parts: &[String]) -> String {
    parts
        .iter()
        .map(|s| {
            if s
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/' | ':' | '='))
            {
                s.clone()
            } else {
                format!("'{}'", s.replace('\'', "'\\''"))
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alias_target() {
        let argv = build_ssh_argv(&SshLaunchArgs {
            user: None,
            host: "ignored",
            port: None,
            ssh_config_alias: Some("prod-api"),
            key_path: None,
            proxy_jump: None,
            identity_agent: None,
            tmux_session: Some("logs"),
            tmux_window: None,
            skip_host_key_check: false,
            password_auth: false,
            detach_others: true,
            mouse_mode: false,
        });
        assert_eq!(argv[0], "ssh");
        assert_eq!(argv[1], "-t");
        assert_eq!(argv[2], "-o");
        assert_eq!(argv[3], "ServerAliveInterval=5");
        assert_eq!(argv[4], "-o");
        assert_eq!(argv[5], "ServerAliveCountMax=2");
        assert_eq!(argv[6], "prod-api");
        assert!(argv[7].contains("new-session"));
    }

    #[test]
    fn user_host_with_port() {
        let argv = build_ssh_argv(&SshLaunchArgs {
            user: Some("storysq"),
            host: "10.0.0.5",
            port: Some(2222),
            ssh_config_alias: None,
            key_path: None,
            proxy_jump: None,
            identity_agent: None,
            tmux_session: None,
            tmux_window: None,
            skip_host_key_check: false,
            password_auth: false,
            detach_others: false,
            mouse_mode: false,
        });
        assert_eq!(
            argv,
            vec![
                "ssh",
                "-t",
                "-o",
                "ServerAliveInterval=5",
                "-o",
                "ServerAliveCountMax=2",
                "-p",
                "2222",
                "storysq@10.0.0.5"
            ]
        );
    }

    #[test]
    fn keyfile_and_window_target() {
        let argv = build_ssh_argv(&SshLaunchArgs {
            user: Some("deploy"),
            host: "prod-a",
            port: Some(2222),
            ssh_config_alias: None,
            key_path: Some("/Users/me/.ssh/prod_ed25519"),
            proxy_jump: None,
            identity_agent: None,
            tmux_session: Some("api"),
            tmux_window: Some("logs"),
            skip_host_key_check: false,
            password_auth: false,
            detach_others: false,
            mouse_mode: false,
        });
        assert_eq!(
            &argv[0..10],
            [
                "ssh",
                "-t",
                "-o",
                "ServerAliveInterval=5",
                "-o",
                "ServerAliveCountMax=2",
                "-p",
                "2222",
                "-i",
                "/Users/me/.ssh/prod_ed25519"
            ]
        );
        assert_eq!(argv[10], "deploy@prod-a");
        assert!(argv[11].contains("-n logs"));
    }

    #[test]
    fn remote_command_uses_batch_mode_without_tty() {
        let argv = build_ssh_remote_command_argv(
            &SshLaunchArgs {
                user: Some("deploy"),
                host: "prod-a",
                port: Some(2222),
                ssh_config_alias: None,
                key_path: Some("/Users/me/.ssh/prod ed25519"),
                proxy_jump: None,
                identity_agent: None,
                tmux_session: None,
                tmux_window: None,
                skip_host_key_check: false,
                password_auth: false,
                detach_others: false,
                mouse_mode: false,
            },
            &vec!["tmux".into(), "list-panes".into(), "-a".into()],
            true,
        );
        assert_eq!(argv[0], "ssh");
        assert!(!argv.contains(&"-t".to_string()));
        assert!(argv.windows(2).any(|w| w == ["-o", "BatchMode=yes"]));
        assert!(argv.windows(2).any(|w| w == ["-p", "2222"]));
        assert!(
            argv.windows(2)
                .any(|w| w == ["-i", "/Users/me/.ssh/prod ed25519"])
        );
        assert_eq!(argv[argv.len() - 2], "deploy@prod-a");
        assert_eq!(argv[argv.len() - 1], "tmux list-panes -a");
    }

    #[test]
    fn probe_uses_batch_mode_and_optional_discarded_known_hosts() {
        let argv = build_ssh_probe_argv(
            &SshLaunchArgs {
                user: Some("deploy"),
                host: "prod-a",
                port: Some(2222),
                ssh_config_alias: None,
                key_path: None,
                proxy_jump: None,
                identity_agent: None,
                tmux_session: None,
                tmux_window: None,
                skip_host_key_check: false,
                password_auth: false,
                detach_others: false,
                mouse_mode: false,
            },
            &vec!["true".into()],
            true,
        );

        assert_eq!(argv[0], "ssh");
        assert!(!argv.contains(&"-t".to_string()));
        assert!(argv.windows(2).any(|w| w == ["-o", "BatchMode=yes"]));
        assert!(argv.windows(2).any(|w| w == ["-o", "ConnectTimeout=5"]));
        assert!(argv
            .windows(2)
            .any(|w| w == ["-o", "StrictHostKeyChecking=no"]));
        assert!(argv
            .windows(2)
            .any(|w| w == ["-o", "UserKnownHostsFile=/dev/null"]));
        assert!(argv.windows(2).any(|w| w == ["-p", "2222"]));
        assert_eq!(argv[argv.len() - 2], "deploy@prod-a");
        assert_eq!(argv[argv.len() - 1], "true");
    }

    #[test]
    fn proxy_jump_and_identity_agent_are_options_before_target() {
        let argv = build_ssh_remote_command_argv(
            &SshLaunchArgs {
                user: Some("deploy"),
                host: "prod-a",
                port: Some(2222),
                ssh_config_alias: None,
                key_path: Some("/Users/me/.ssh/prod_ed25519"),
                proxy_jump: Some("bastion"),
                identity_agent: Some("/tmp/agent.sock"),
                tmux_session: None,
                tmux_window: None,
                skip_host_key_check: false,
                password_auth: false,
                detach_others: false,
                mouse_mode: false,
            },
            &vec!["true".into()],
            true,
        );

        let target_idx = argv.iter().position(|s| s == "deploy@prod-a").unwrap();
        let proxy_idx = argv.iter().position(|s| s == "-J").unwrap();
        let agent_idx = argv
            .windows(2)
            .position(|w| w == ["-o", "IdentityAgent=/tmp/agent.sock"])
            .unwrap();

        assert_eq!(argv[proxy_idx + 1], "bastion");
        assert!(proxy_idx < target_idx, "ProxyJump must precede target");
        assert!(agent_idx < target_idx, "IdentityAgent must precede target");
    }

    #[test]
    fn password_auth_preferred_authentications() {
        let argv = build_ssh_argv(&SshLaunchArgs {
            user: Some("storysq"),
            host: "10.0.0.5",
            port: None,
            ssh_config_alias: None,
            key_path: None,
            proxy_jump: None,
            identity_agent: None,
            tmux_session: None,
            tmux_window: None,
            skip_host_key_check: false,
            password_auth: true,
            detach_others: false,
            mouse_mode: false,
        });
        assert_eq!(argv[0], "ssh");
        assert!(argv.windows(2).any(|w| w == ["-o", "PreferredAuthentications=password"]));
    }
}
