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

/// Find the byte length to safely deliver downstream from `buf` such that no
/// multi-byte UTF-8 sequence is split across a chunk boundary. Returns
/// `buf.len()` when the trailing bytes form a complete UTF-8 character, or a
/// smaller offset that leaves an incomplete leading sequence to be carried
/// into the next read.
fn utf8_safe_split(buf: &[u8]) -> usize {
    let len = buf.len();
    if len == 0 {
        return 0;
    }
    // A UTF-8 character is at most 4 bytes, so the start of any incomplete
    // trailing sequence is within the last 3 bytes.
    let scan_start = len.saturating_sub(3);
    for i in (scan_start..len).rev() {
        let byte = buf[i];
        if byte < 0x80 {
            // 1-byte ASCII char, complete at i+1.
            return len;
        }
        if byte & 0xC0 == 0x80 {
            // Continuation byte, keep walking back.
            continue;
        }
        // Leader byte: figure out the expected sequence length.
        let expected = if byte & 0xF8 == 0xF0 {
            4
        } else if byte & 0xF0 == 0xE0 {
            3
        } else if byte & 0xE0 == 0xC0 {
            2
        } else {
            // Invalid leader; let lossy decode replace it and move on.
            return len;
        };
        return if i + expected <= len { len } else { i };
    }
    // No leader found in the last 3 bytes; the buffer ends in pure
    // continuation bytes, which by themselves can't form a valid char. Defer
    // them entirely.
    scan_start
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

        let (tx, rx) = std::sync::mpsc::channel::<String>();
        let channel_for_sender = channel_for_reader.clone();

        // Spawn a dedicated thread to batch and send raw terminal data to the frontend.
        // This decouples the critical OS PTY reading from blocking network/IPC calls,
        // resolving PTY backpressure stalls/deadlocks when modern CLI tools (like Claude/Codex)
        // produce heavy screen rendering streams.
        thread::spawn(move || {
            loop {
                match rx.recv() {
                    Ok(first_chunk) => {
                        let mut merged = first_chunk;
                        // Batch multiple outstanding chunks to reduce IPC overhead
                        while let Ok(next_chunk) = rx.try_recv() {
                            merged.push_str(&next_chunk);
                        }
                        if channel_for_sender
                            .send(PtyEvent::Data { data: merged })
                            .is_err()
                        {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        thread::spawn(move || {
            let mut buf = [0u8; 8192];
            // Bytes carried over from the previous read() because they were
            // the start of a multi-byte UTF-8 sequence whose continuation
            // landed in the next chunk. Without this carry-over,
            // from_utf8_lossy replaces the split bytes with U+FFFD and
            // corrupts box-drawing / CJK / emoji glyphs at chunk boundaries.
            let mut leftover: Vec<u8> = Vec::new();
            let mut tail = String::new();
            let mut fingerprint_detected = false;
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let mut combined = std::mem::take(&mut leftover);
                        combined.extend_from_slice(&buf[..n]);
                        let split_at = utf8_safe_split(&combined);
                        let (deliver, defer) = combined.split_at(split_at);
                        let chunk = String::from_utf8_lossy(deliver).to_string();
                        if !defer.is_empty() {
                            leftover = defer.to_vec();
                        }
                        // Queue the chunk for non-blocking dispatch to the frontend
                        if tx.send(chunk.clone()).is_err() {
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
                                let keep_start = tail.len() - 512;
                                if let Some(idx) = tail.char_indices().map(|(i, _)| i).find(|&i| i >= keep_start) {
                                    tail.drain(..idx);
                                }
                            }

                            if !fingerprint_detected && looks_like_fingerprint_prompt(&tail) {
                                let challenge = tail.clone();
                                let _ = channel_for_reader.send(PtyEvent::Fingerprint {
                                    challenge,
                                });
                                fingerprint_detected = true;
                            }

                            if let Some(pw) = auto_password.as_deref() {
                                let used = password_used_for_reader.load(Ordering::Relaxed);
                                let is_prompt = looks_like_password_prompt(&tail);
                                if !used && is_prompt {
                                    password_used_for_reader.store(true, Ordering::Relaxed);
                                    let pw_clone = pw.to_string();
                                    let writer_clone = writer_for_reader.clone();
                                    thread::spawn(move || {
                                        // Sleep in a separate thread to avoid blocking the critical PTY Reader loop
                                        thread::sleep(std::time::Duration::from_millis(300));
                                        if let Ok(mut w) = writer_clone.lock() {
                                            let _ = w.write_all(pw_clone.as_bytes());
                                            let _ = w.write_all(b"\n");
                                            let _ = w.flush();
                                        }
                                    });
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
        // Disarm password watcher on first user interaction (excluding automated fingerprint approval)
        if data != "yes\n" && data != "yes\r\n" && data != "yes\r" {
            s.password_used.store(true, Ordering::Relaxed);
        }
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

    #[test]
    fn utf8_split_keeps_complete_ascii() {
        let buf = b"hello world";
        assert_eq!(utf8_safe_split(buf), buf.len());
    }

    #[test]
    fn utf8_split_defers_split_3byte_char() {
        // U+2500 BOX DRAWINGS LIGHT HORIZONTAL = 0xE2 0x94 0x80
        let mut buf = b"abc".to_vec();
        buf.push(0xE2);
        buf.push(0x94);
        // Last byte (0x80) is missing; should defer the 3-byte leader.
        let split = utf8_safe_split(&buf);
        assert_eq!(split, 3);
        assert_eq!(&buf[..split], b"abc");
        assert_eq!(&buf[split..], &[0xE2, 0x94]);
    }

    #[test]
    fn utf8_split_keeps_complete_3byte_char() {
        let mut buf = b"abc".to_vec();
        buf.extend_from_slice(&[0xE2, 0x94, 0x80]); // ─
        let split = utf8_safe_split(&buf);
        assert_eq!(split, buf.len());
    }

    #[test]
    fn utf8_split_defers_split_4byte_char() {
        // U+1F984 UNICORN = F0 9F A6 84
        let mut buf = b"x".to_vec();
        buf.extend_from_slice(&[0xF0, 0x9F]);
        let split = utf8_safe_split(&buf);
        assert_eq!(split, 1);
        assert_eq!(&buf[split..], &[0xF0, 0x9F]);
    }

    #[test]
    fn utf8_split_handles_pure_continuation_tail() {
        // Pathological: buffer ends in 3 continuation bytes with no leader in
        // the scan window. Defer them so they can join the next read.
        let buf = vec![0x80u8, 0x80, 0x80, 0x80];
        let split = utf8_safe_split(&buf);
        assert_eq!(split, 1);
    }

    #[test]
    fn utf8_split_handles_empty() {
        assert_eq!(utf8_safe_split(&[]), 0);
    }
}
