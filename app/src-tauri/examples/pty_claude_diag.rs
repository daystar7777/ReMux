//! Standalone diagnostic that runs `claude` through REMUX's exact PTY
//! reader pipeline (portable_pty + mpsc batcher + UTF-8 boundary split)
//! and reports the byte count + first 1 KB of captured output over a
//! short window. If this captures the claude welcome banner, REMUX's
//! local PTY path is healthy; any blank-screen symptom must lie in the
//! SSH/tmux chain or the xterm.js side.
//!
//! Run with: `cargo run --example pty_claude_diag`

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::Read;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

fn utf8_safe_split(buf: &[u8]) -> usize {
    let len = buf.len();
    if len == 0 {
        return 0;
    }
    let scan_start = len.saturating_sub(3);
    for i in (scan_start..len).rev() {
        let byte = buf[i];
        if byte < 0x80 {
            return len;
        }
        if byte & 0xC0 == 0x80 {
            continue;
        }
        let expected = if byte & 0xF8 == 0xF0 {
            4
        } else if byte & 0xF0 == 0xE0 {
            3
        } else if byte & 0xE0 == 0xC0 {
            2
        } else {
            return len;
        };
        return if i + expected <= len { len } else { i };
    }
    scan_start
}

fn main() -> anyhow::Result<()> {
    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize {
        rows: 36,
        cols: 137,
        pixel_width: 0,
        pixel_height: 0,
    })?;

    let mut cmd = CommandBuilder::new("claude");
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env(
        "LANG",
        std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".into()),
    );

    let mut child = pair.slave.spawn_command(cmd)?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader()?;

    let (tx, rx) = mpsc::channel::<String>();

    // Reader thread (mirrors pty.rs)
    let reader_handle = thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut leftover: Vec<u8> = Vec::new();
        let mut total = 0usize;
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    total += n;
                    let mut combined = std::mem::take(&mut leftover);
                    combined.extend_from_slice(&buf[..n]);
                    let split_at = utf8_safe_split(&combined);
                    let (deliver, defer) = combined.split_at(split_at);
                    let chunk = String::from_utf8_lossy(deliver).to_string();
                    if !defer.is_empty() {
                        leftover = defer.to_vec();
                    }
                    if tx.send(chunk).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        total
    });

    // Batcher thread (mirrors pty.rs)
    let (frontend_tx, frontend_rx) = mpsc::channel::<String>();
    thread::spawn(move || loop {
        match rx.recv() {
            Ok(first) => {
                let mut merged = first;
                while let Ok(next) = rx.try_recv() {
                    merged.push_str(&next);
                }
                if frontend_tx.send(merged).is_err() {
                    break;
                }
            }
            Err(_) => break,
        }
    });

    // Frontend-side: accumulate for 6 seconds, then kill child
    let start = Instant::now();
    let mut captured = String::new();
    let timeout = Duration::from_secs(6);
    while start.elapsed() < timeout {
        match frontend_rx.recv_timeout(Duration::from_millis(200)) {
            Ok(chunk) => captured.push_str(&chunk),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    let _ = child.kill();
    let total_bytes = reader_handle.join().unwrap_or(0);

    println!("\n=== REMUX PTY pipeline diagnostic ===");
    println!("Reader thread total bytes from PTY: {}", total_bytes);
    println!("Frontend captured string bytes: {}", captured.len());
    println!("Captured char count: {}", captured.chars().count());
    println!("First 1 KB of captured output (lossy debug repr):");
    let preview_len = captured.len().min(1024);
    println!("{:?}", &captured[..preview_len]);

    if captured.contains("Claude Code") {
        println!("\nRESULT: PTY pipeline DELIVERED the claude welcome banner.");
        println!("REMUX's local PTY path is functional.");
    } else {
        println!("\nRESULT: welcome banner NOT in captured output.");
        println!("Either claude failed to spawn, or REMUX's PTY layer dropped data.");
    }

    Ok(())
}
