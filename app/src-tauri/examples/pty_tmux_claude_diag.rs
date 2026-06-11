//! Spawns `tmux new-session` + `claude` through REMUX's exact PTY
//! pipeline LOCALLY (no SSH). Compares to pty_claude_diag.rs (raw claude
//! with no tmux). If raw claude works but tmux-wrapped claude
//! doesn't, the bug is in tmux<->claude interaction, not the SSH chain.
//!
//! Run with: `cargo run --example pty_tmux_claude_diag`

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

fn main() -> anyhow::Result<()> {
    let socket = "/private/tmp/remux-diag-sock";
    let _ = std::fs::remove_file(socket);

    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize {
        rows: 36,
        cols: 137,
        pixel_width: 0,
        pixel_height: 0,
    })?;

    // Mirror exactly what REMUX would spawn for a local tmux profile.
    let mut cmd = CommandBuilder::new("/opt/homebrew/bin/tmux");
    cmd.arg("-S");
    cmd.arg(socket);
    cmd.arg("new-session");
    cmd.arg("-A");
    cmd.arg("-s");
    cmd.arg("remux-claude-diag");
    cmd.arg("-n");
    cmd.arg("zsh");
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env(
        "LANG",
        std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".into()),
    );

    let mut child = pair.slave.spawn_command(cmd)?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader()?;
    let writer = Arc::new(Mutex::new(pair.master.take_writer()?));

    // Reader thread accumulates bytes.
    let captured = Arc::new(Mutex::new(Vec::<u8>::new()));
    let captured_for_reader = captured.clone();
    let reader_handle = thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    captured_for_reader
                        .lock()
                        .unwrap()
                        .extend_from_slice(&buf[..n]);
                }
                Err(_) => break,
            }
        }
    });

    // Wait for tmux to attach + show shell prompt.
    thread::sleep(Duration::from_millis(1500));

    eprintln!("[diag] tmux attached, sending `claude\\n` to inner shell");
    {
        let mut w = writer.lock().unwrap();
        w.write_all(b"claude\n")?;
        w.flush().ok();
    }

    // Watch for claude rendering up to 10 seconds.
    let start = Instant::now();
    let timeout = Duration::from_secs(10);
    let mut last_len = 0usize;
    let mut quiet_since: Option<Instant> = None;
    loop {
        thread::sleep(Duration::from_millis(250));
        let len = captured.lock().unwrap().len();
        if len > last_len {
            last_len = len;
            quiet_since = None;
            eprintln!(
                "[diag] +bytes -> total {} bytes at {:.1}s",
                len,
                start.elapsed().as_secs_f32()
            );
        } else if quiet_since.is_none() {
            quiet_since = Some(Instant::now());
        }
        if start.elapsed() > timeout {
            break;
        }
        if let Some(q) = quiet_since {
            if q.elapsed() > Duration::from_secs(3) {
                eprintln!("[diag] quiet for 3s — stopping early");
                break;
            }
        }
    }

    // Best-effort: send Ctrl+C to stop claude + exit tmux.
    {
        let mut w = writer.lock().unwrap();
        let _ = w.write_all(&[0x03]); // SIGINT
        let _ = w.write_all(b"exit\n");
        let _ = w.flush();
    }
    thread::sleep(Duration::from_millis(500));
    let _ = child.kill();
    let _ = reader_handle.join();

    // Kill the tmux server too so we don't leave a session around.
    let _ = std::process::Command::new("/opt/homebrew/bin/tmux")
        .args(["-S", socket, "kill-server"])
        .status();
    let _ = std::fs::remove_file(socket);

    let bytes = captured.lock().unwrap().clone();
    let lossy = String::from_utf8_lossy(&bytes);

    println!("\n=== tmux + claude PTY pipeline diagnostic ===");
    println!("Total bytes captured: {}", bytes.len());
    let preview = &lossy[..lossy.len().min(2000)];
    println!("First 2 KB lossy:\n{:?}", preview);

    let has_banner = lossy.contains("Claude Code");
    let has_welcome = lossy.contains("Welcome") || lossy.contains("Tips");
    let has_status = lossy.contains("claude") || lossy.contains("remux-claude-diag");
    println!("\nMarkers:");
    println!("  Contains 'Claude Code': {}", has_banner);
    println!("  Contains 'Welcome'/'Tips': {}", has_welcome);
    println!("  Contains 'claude'/'session name': {}", has_status);

    if has_banner {
        println!("\nRESULT: tmux + local claude through REMUX pty path RENDERS.");
        println!("If the user still sees blank inside REMUX, the diff is the SSH chain or the remote host.");
    } else {
        println!("\nRESULT: tmux-wrapped claude did NOT emit its welcome banner here either.");
        println!("Either local claude in tmux is also broken, or claude needed user input we did not provide.");
    }

    Ok(())
}
