# ReMux 🚀

[![Latest Release](https://img.shields.io/github/v/release/daystar7777/ReMux?color=blue&label=Release)](https://github.com/daystar7777/ReMux/releases)
[![Build Status](https://img.shields.io/badge/Build-Passed-success)](https://github.com/daystar7777/ReMux)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-lightgrey)](https://github.com/daystar7777/ReMux)
[![Language](https://img.shields.io/badge/Language-English%20%7C%20%ED%95%9C%EA%B5%AD%EC%96%B4-orange)](#translations)

**ReMux** is a premium, high-performance desktop GUI manager for **tmux** sessions, built with **Tauri**, **React**, **Jotai**, and **xterm.js**. Designed natively for macOS & Windows, ReMux elevates standard terminal multiplexing into an elite, visual, and highly responsive developer workspace.

---

## 🌐 Translations / 다른 언어 번역

* **[한국어 리드미 (Korean README)](README.ko.md)**
* **[Interactive HTML Usage Guide / 사용법 가이드](docs/usage.html)**

---

## 📥 Download v0.1.0-Beta

Select your platform below to download the pre-compiled ReMux bundles directly from our latest release:

*   🍎 **macOS**: **[Download ReMux for macOS (v0.1.0-Beta)](https://github.com/daystar7777/ReMux/releases/download/v0.1.0-beta/REMUX-macOS.zip)**
*   🪟 **Windows**: **[Download ReMux for Windows (.msi)](https://github.com/daystar7777/ReMux/releases)** (Available on the [GitHub Releases](https://github.com/daystar7777/ReMux/releases) page)

---

## ✨ Features Overview

*   **Recursive Terminal Splits Grid**: Create advanced horizontal and vertical splits (`Ctrl+Shift+E` / `Ctrl+Shift+D`) recursively inside your workspaces to tile commands efficiently.
*   **Synchronized Broadcast Input Mode**: Transmit keyboard inputs concurrently across all active split panes in the current tab. Enabled with an absolute visual warning (neon pulsating alert borders).
*   **Live Session & Window Inventory Sidebar**: Navigate all local and remote tmux instances visually. Spawn windows, kill targets with prompts, and rename elements dynamically on hover.
*   **Try-and-Fallback Tmux Version Compatibility**: Adaptive Rust backend detects tmux versions and transparently applies fallback commands for older servers (legacy mouse options for tmux < 2.1; graceful warning degradations for pane titles on tmux < 3.0).
*   **Custom Performance & Telemetry Sliders**: Fine-tune background telemetry and inventory polling rates using premium preset profiles (Eco, Battery Saver, Balanced, High Performance) to conserve system memory.
*   **Elite VS Code-Style Hotkeys & Circular Navigation**: Symmetrically navigate panes (`Ctrl+Shift+Tab`) and tabs (`Ctrl+Tab`) with boundary-wrapping, and toggle panels dynamically (`Cmd+B`, `Cmd+Shift+I`, `Cmd+,`).
*   **PasteGuard & Drag-Selection System Clipboard**: Highlights are automatically copied to your native macOS clipboard upon release (exiting drag mode cleanly). PasteGuard defends against malicious multiline script execution.
*   **Keychain-Safe Connection Tester & Heartbeats**: Authenticate SSH servers using macOS native Keychain, and auto-recover connections with glassmorphic reconnection overlays on network drop.

---

## ⌨️ Global Keyboard Shortcut Reference

| Key Combination | Action Description |
| :--- | :--- |
| `Cmd + B` | Toggle Primary Left Sidebar panel |
| `Cmd + Shift + I` | Toggle Live Tmux Inventory Sidebar |
| `Cmd + ,` | Toggle Appearance & Telemetry Settings Panel |
| `Ctrl + Tab` | Focus Next Tab (Circular Boundary Wrapping) |
| `Ctrl + Shift + Tab` | Focus Next Split Pane (Circular Boundary Wrapping) |
| `Ctrl + Shift + E` | Split Active Terminal Pane **Vertically** |
| `Ctrl + Shift + D` | Split Active Terminal Pane **Horizontally** |
| `Ctrl + Shift + W` | Close Active Pane (Closes tab if it is the last pane) |
| `Ctrl + Shift + C` | Copy highlighted text to macOS System Clipboard and exit Drag mode |
| `Ctrl + Shift + V` | Paste macOS Clipboard content (runs through PasteGuard validation) |
| `Ctrl + Alt + Arrow Keys` | Move pane focus in direction of arrow |

---

## 🛠️ Development & Compilation

To launch ReMux in development mode locally:

```bash
# 1. Clone the repository
git clone https://github.com/daystar7777/ReMux.git
cd ReMux/app

# 2. Install dependencies
npm install

# 3. Spin up Tauri development environment
npm run dev
```

### Release Verification Gate

To execute the strict production gate verifying typechecking, test suites, and tmux smoke tests:

```bash
npm run verify:release
```

---

## 🛡️ License

Distributed under the MIT License. See `LICENSE` for more information.
