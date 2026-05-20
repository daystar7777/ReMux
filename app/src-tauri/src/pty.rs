use anyhow::{anyhow, Context, Result};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::ipc::Channel;
use uuid::Uuid;

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PtyEvent {
    Data { data: String },
    Exit { code: Option<i32> },
    Fingerprint { challenge: String },
}

type SharedWriter = Arc<Mutex<Box<dyn Write + Send>>>;

struct Session {
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: SharedWriter,
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
    password_used: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<String, Session>>,
}

#[derive(Debug, Default, Clone)]
pub struct SpawnOptions {
    pub cwd: Option<String>,
    pub env: Vec<(String, String)>,
    /// If set, the reader thread looks for an OpenSSH `Password:` or
    /// `passphrase` prompt on the PTY and writes this string + newline back
    /// exactly once. Used to opt-in to saved-credential SSH login while
    /// keeping system `ssh` as the transport.
    pub auto_password: Option<String>,
}

fn looks_like_password_prompt(window: &str) -> bool {
    // Matches "Password:" / "Password for X:" / "X's password:" /
    // "Enter passphrase for key '...':" near end-of-buffer, case insensitive.
    let lower = window.to_ascii_lowercase();
    let trimmed = lower.trim_end_matches(|c: char| c.is_whitespace() || c == '\u{a0}');
    trimmed.ends_with("password:")
        || trimmed.ends_with("passphrase:")
        || (trimmed.contains("password") && trimmed.ends_with("':"))
        || (trimmed.contains("passphrase for key") && trimmed.ends_with(":"))
}

fn looks_like_fingerprint_prompt(window: &str) -> bool {
    let lower = window.to_ascii_lowercase();
    lower.contains("are you sure you want to continue connecting")
}

impl PtyManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn spawn(
        &self,
        argv: Vec<String>,
        cols: u16,
        rows: u16,
        channel: Channel<PtyEvent>,
        opts: SpawnOptions,
    ) -> Result<String> {
        if argv.is_empty() {
            return Err(anyhow!("argv must contain a program"));
        }
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| anyhow!("openpty failed: {e}"))?;

        let mut cmd = CommandBuilder::new(&argv[0]);
        if argv.len() > 1 {
            cmd.args(&argv[1..]);
        }
        if let Some(dir) = opts.cwd {
            cmd.cwd(dir);
        }
        for (k, v) in opts.env {
            cmd.env(k, v);
        }
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        let lang = std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".into());
        cmd.env("LANG", lang);

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| anyhow!("spawn pty child failed: {e}"))?;
        drop(pair.slave);

        let raw_writer = pair
            .master
            .take_writer()
            .map_err(|e| anyhow!("take_writer failed: {e}"))?;
        let writer: SharedWriter = Arc::new(Mutex::new(raw_writer));
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| anyhow!("clone reader failed: {e}"))?;

        let id = Uuid::new_v4().to_string();
        let child = Arc::new(Mutex::new(child));
        let password_used = Arc::new(AtomicBool::new(false));

        let mut sessions = self.sessions.lock().unwrap();
        sessions.insert(
            id.clone(),
            Session {
                master: pair.master,
                writer: writer.clone(),
                child: child.clone(),
                password_used: password_used.clone(),
            },
        );
        drop(sessions);

        let channel_for_reader = channel.clone();
        let child_for_waiter = child.clone();
        let id_for_waiter = id.clone();
        let channel_for_waiter = channel.clone();
        let writer_for_reader = writer.clone();
        let auto_password = opts.auto_password;
        let password_used_for_reader = password_used.clone();

        // 15-second self-destruct for password watcher
        let password_used_for_timeout = password_used.clone();
        thread::spawn(move || {
            thread::sleep(std::time::Duration::from_secs(15));
            password_used_for_timeout.store(true, Ordering::Relaxed);
        });

        thread::spawn(move || {
            let mut buf = [0u8; 8192];
            let mut tail = String::new();
            let mut fingerprint_detected = false;
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                        if channel_for_reader
                            .send(PtyEvent::Data { data: chunk.clone() })
                            .is_err()
                        {
                            break;
                        }

                        let mut check_tail = false;
                        if let Some(_) = auto_password.as_deref() {
                            if !password_used_for_reader.load(Ordering::Relaxed) {
                                check_tail = true;
                            }
                        }
                        if !fingerprint_detected {
                            check_tail = true;
                        }

                        if check_tail {
                            tail.push_str(&chunk);
                            if tail.len() > 512 {
                                let drop_n = tail.len() - 512;
                                tail.drain(..drop_n);
                            }

                            if !fingerprint_detected && looks_like_fingerprint_prompt(&tail) {
                                let challenge = tail.clone();
                                let _ = channel_for_reader.send(PtyEvent::Fingerprint {
                                    challenge,
                                });
                                fingerprint_detected = true;
                            }

                            if let Some(pw) = auto_password.as_deref() {
                                if !password_used_for_reader.load(Ordering::Relaxed)
                                    && looks_like_password_prompt(&tail)
                                {
                                    if let Ok(mut w) = writer_for_reader.lock() {
                                        let _ = w.write_all(pw.as_bytes());
                                        let _ = w.write_all(b"\n");
                                        let _ = w.flush();
                                    }
                                    password_used_for_reader.store(true, Ordering::Relaxed);
                                    tail.clear();
                                }
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        thread::spawn(move || {
            let exit_code = {
                let mut guard = child_for_waiter.lock().unwrap();
                guard.wait().ok().map(|s| s.exit_code() as i32)
            };
            let _ = channel_for_waiter.send(PtyEvent::Exit { code: exit_code });
            let _ = id_for_waiter;
        });

        Ok(id)
    }

    pub fn write(&self, id: &str, data: &str) -> Result<()> {
        let sessions = self.sessions.lock().unwrap();
        let s = sessions.get(id).context("write: unknown session id")?;
        // Disarm password watcher on first user interaction
        s.password_used.store(true, Ordering::Relaxed);
        let mut w = s.writer.lock().unwrap();
        w.write_all(data.as_bytes()).context("pty write")?;
        w.flush().ok();
        Ok(())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<()> {
        let sessions = self.sessions.lock().unwrap();
        let s = sessions.get(id).context("resize: unknown session id")?;
        s.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| anyhow!("resize failed: {e}"))?;
        Ok(())
    }

    pub fn kill(&self, id: &str) -> Result<()> {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(s) = sessions.remove(id) {
            let mut guard = s.child.lock().unwrap();
            let _ = guard.kill();
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_password_prompt() {
        assert!(looks_like_password_prompt("storysq@10.0.0.5's password: "));
        assert!(looks_like_password_prompt("Password: "));
        assert!(looks_like_password_prompt("Enter passphrase for key '/Users/me/.ssh/id_ed25519':"));
        assert!(!looks_like_password_prompt("Last login: ..."));
        assert!(!looks_like_password_prompt(""));
    }

    #[test]
    fn detects_fingerprint_prompt() {
        assert!(looks_like_fingerprint_prompt("The authenticity of host '10.0.0.5 (10.0.0.5)' can't be established.\nED25519 key fingerprint is SHA256:7u7Xq...\nAre you sure you want to continue connecting (yes/no/[fingerprint])? "));
        assert!(looks_like_fingerprint_prompt("are you sure you want to continue connecting (yes/no)?"));
        assert!(!looks_like_fingerprint_prompt("Last login: ..."));
        assert!(!looks_like_fingerprint_prompt(""));
    }
}
