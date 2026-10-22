# PulseBridge ⚡ v2.0.0
### Universal Remote AI IDE Companion & Telemetry Bridge
> *"The high-precision, zero-trust mobile bridge for AI-native engineering environments (Google Antigravity, Cursor AI, VS Code, and Visual Studio)."*

[![Version](https://img.shields.io/badge/Version-v2.0.0-eab308?style=for-the-badge)](https://github.com/ModernOps888/pulsebridge/releases/tag/v2.0.0)
[![Rust](https://img.shields.io/badge/Rust-2021%20Edition-black?style=for-the-badge&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![Axum](https://img.shields.io/badge/Axum-0.7-black?style=for-the-badge&logo=rust)](https://github.com/tokio-rs/axum)
[![React](https://img.shields.io/badge/React-19-black?style=for-the-badge&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-black?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-v4-black?style=for-the-badge&logo=tailwindcss)](https://tailwindcss.com/)
[![Windows GDI](https://img.shields.io/badge/Win32-HALFTONE%20GDI-black?style=for-the-badge&logo=windows)](https://learn.microsoft.com/en-us/windows/win32/gdi/windows-gdi)
[![SecOps Audited](https://img.shields.io/badge/SecOps-Zero%20Trust%20Hardened-10b981?style=for-the-badge&logo=security)](SECURITY.md)
[![Test Suites](https://img.shields.io/badge/Verification-7%2F7%20Suites%20Passed-10b981?style=for-the-badge&logo=checkmarx)](tests/)
[![License: MIT](https://img.shields.io/badge/License-MIT-eab308?style=for-the-badge)](LICENSE)

---

## 🌟 Executive Summary

**PulseBridge v2.0.0** empowers software engineers to step away from their workstations while retaining real-time visibility, telemetry tracking, and bidirectional interactive control of their AI agents and development environments straight from their smartphones.

Whether you are walking outside on **4G/5G cellular data**, grabbing coffee, or working across rooms on Wi-Fi, PulseBridge streams your AI agent's internal reasoning, tool invocations, interactive decision requests, project file trees, DevOps shell runbooks, and desktop IDE viewport directly to your mobile browser in a fluid, low-latency, mobile-first interface styled in **Obsidian, Radiant Gold, and Cyber Emerald Green**.

---

## 🆕 What's New in v2.0.0 (Surgical Architecture Overhaul)

1. **Precision 2-Finger Pinch-to-Zoom & 100%–300% Docked Zoom Bar (`IdePreview.tsx`)**:
   - Native multi-touch 2-finger pinch-to-zoom (`100%` to `300%`) with focal-point preservation and a docked quick-preset bar (`100%`, `125%`, `150%`, `200%`, `250%`, `300%`) plus fine `±25%` step controls.
   - Eliminates `object-fit: contain` letterbox skew by rendering the streamed desktop frame at `width: ${zoomLevel}%` with `height: auto`, guaranteeing **exact 1:1 coordinate parity** (`x_ratio`, `y_ratio`) across all zoom levels and aspect ratios.
   - Smooth 2D pan and kinetic drag-to-wheel scrolling (`SendInput(MOUSEEVENTF_WHEEL)`) with zero CSS layout transition lag and full `pointercancel` cleanup.

2. **HALFTONE Win32 GDI Capture & `IsIconic`-Safe Window Focus (`capture.rs`, `remote_action.rs`)**:
   - Upgrades `StretchBlt` rasterization from `COLORONCOLOR` to **`HALFTONE` with `SetBrushOrgEx(0, 0)`**, preserving crisp sub-pixel syntax highlighting and terminal typography on mobile screens.
   - Preserves true source monitor/window aspect ratios (`dst_h` derived directly from `src_w` / `src_h` rather than hardcoded 16:9), preventing vertical squashing on 16:10, 4:3, or split-screen IDE windows.
   - Guards `ShowWindow(hwnd, SW_RESTORE)` behind **`IsIconic(hwnd)`**, ensuring that focusing or clicking a maximized IDE window never un-maximizes it on the host desktop.
   - Detects minimized IDE windows and falls back cleanly to primary desktop capture instead of returning black buffers.

3. **48-Hotkey Win32 Virtual Keyboard & `KEYEVENTF_EXTENDEDKEY` Engine (`remote_action.rs`, `IdePreview.tsx`)**:
   - Expands `send_virtual_hotkey` to **48 named shortcuts and keys** with case-insensitive `+` / `-` / `_` normalization (supporting `ctrl+shift+p`, `ctrl_shift_p`, `ctrl+backtick`, `f1`–`f12`, navigation keys, clipboard chords, zoom chords, and custom chord dispatch).
   - Emits **`KEYEVENTF_EXTENDEDKEY`** on all navigation and arrow keys (`VK_UP`, `VK_DOWN`, `VK_LEFT`, `VK_RIGHT`, `VK_HOME`, `VK_END`, `VK_PRIOR`, `VK_NEXT`, `VK_INSERT`, `VK_DELETE`), ensuring Chromium/Electron IDEs (Antigravity, Cursor, VS Code) interpret navigation keys accurately regardless of NumLock state.
   - Mobile IDE viewport includes a 4-row categorized hotkey deck (Core Editing, Navigation, AI & Terminal, Function/System) plus a custom chord input box and live visual/haptic toast confirmation.

4. **Bidirectional `/api/inbox` Queue & Authenticated MCP Server (`api.rs`, `state.rs`, `pulsebridge-mcp/index.mjs`)**:
   - Adds a first-class in-memory and disk-backed inbox queue (`GET /api/inbox?unread_only=true&ack=true`) that records mobile prompts, `ask_phone` decision chip selections, and quick feedback taps.
   - Automatically persists an internal loopback token in `%TEMP%\pulsebridge_tokens.json` at daemon startup so `pulsebridge-mcp` and `pulsebridge-extension` authenticate seamlessly against Zero-Trust Bearer-gated `/api/ingest/*` and `/api/inbox` routes.
   - `ask_phone` now supports optional blocking wait (`wait_for_reply`, `timeout_secs`) to poll `/api/inbox` and return the engineer's mobile decision chip tap directly to the calling AI agent in a single tool turn.

5. **Multi-Project Workspace vs. Conversation Resolution & Cross-Bleed Prevention (`api.rs`, `antigravity.rs`, `ChatStream.tsx`)**:
   - Resolves both workspace-level IDs (`antigravity-workspace-<slug>`) and raw conversation UUIDs in `/api/project/structure` and `/api/project/chats`.
   - Preserves `ASK_QUESTION` steps and summarizes `tool_calls` in historical transcripts (`antigravity.rs`), rendering interactive `[OPTIONS: ...]` decision chips and 1-tap feedback chips on the latest agent message.
   - Filters incoming WebSocket `StepAdded` events by active conversation ID so background conversations never bleed into the currently viewed project thread.

6. **Context-Aware DevOps Shell Runbooks (`remote_action.rs`, `RemoteControlDrawer.tsx`)**:
   - Enhances opt-in `--enable-shell-commands` execution to accept an optional `cwd` project path (with automatic monorepo subfolder detection for `Cargo.toml`, `package.json`, `pyproject.toml`, and `.git`), returning full `stdout`, `stderr`, and exit status to the mobile terminal drawer even on non-zero exit codes.
   - Hardens argument validation to block `\r` and `\n` newline command-chaining vectors.

---

## 🛡️ Security Audit & Zero-Trust Hardening (Remediation Matrix)

PulseBridge enforces a strict **Zero-Trust Architecture** across all local and remote endpoints:

| Vulnerability Finding | CWE Reference | Pre-Audit Vulnerability & Risk | Hardened Remediation & Verification | Status |
| :--- | :--- | :--- | :--- | :---: |
| **Action Endpoint Auth** | [CWE-306](https://cwe.mitre.org/data/definitions/306.html) | Action routes executed payloads without verifying session tokens. | **100% Gated**: Every action and ingest route (`/api/action/*`, `/api/ingest/*`, `/api/inbox`) strictly requires verified Bearer tokens. Unauthenticated calls yield `401 Unauthorized`. | :white_check_mark: Fixed |
| **Command Injection / RCE** | [CWE-78](https://cwe.mitre.org/data/definitions/78.html) | Arbitrary PowerShell execution via `ExecuteCommand` payload. | **Opt-In Sandboxed**: Disabled by default. Requires `--enable-shell-commands`. Constrained to curated DevOps allowlist (`git`, `cargo`, `npm`, `pnpm`, `yarn`, `pytest`); rejects shell chaining (`&`, `;`, `|`, `` ` ``, `$`, `\r`, `\n`). | :white_check_mark: Fixed |
| **Rate-Limit Bypass** | [CWE-290](https://cwe.mitre.org/data/definitions/290.html) | Brute-force limiter keyed on spoofable `X-Forwarded-For` header. | **Kernel-Level Peer Tracking**: Keyed strictly on physical TCP socket peer (`ConnectInfo<SocketAddr>`). Spoofed headers ignored. 5 failed PINs trigger instant 300s IP lockout. | :white_check_mark: Fixed |
| **Permissive Wildcard CORS** | [CWE-942](https://cwe.mitre.org/data/definitions/942.html) | Wildcard `Any` allowed any external browser tab to pivot to localhost. | **Restricted Origin Predicate**: Origin whitelist restricted strictly to loopback (`localhost`), local workstation LAN IP, and verified Cloudflare tunnels (`*.trycloudflare.com`). | :white_check_mark: Fixed |
| **Unauthenticated WebSocket** | [CWE-287](https://cwe.mitre.org/data/definitions/287.html) | Clients could tap `/ws` and passively consume agent thought stream. | **Token-Verified Handshake**: Silenced until client proves authentication. Unauthenticated connections forcefully terminated after 15s. | :white_check_mark: Fixed |
| **Credential URL Exposure** | [CWE-598](https://cwe.mitre.org/data/definitions/598.html) | PIN and token exposed in mobile browser address bar and history. | **In-Memory URL Scrubbing**: Frontend immediately cleans query parameters using `window.history.replaceState` upon initial parse. | :white_check_mark: Fixed |
| **Transport Guarantees** | [CWE-319](https://cwe.mitre.org/data/definitions/319.html) | Inaccurate "Encrypted HTTPS" claim for local HTTP daemon. | **Honest Framing**: Clarified as HTTP/WS locally on trusted LAN, TLS encrypted end-to-end via Cloudflare Quick Tunnel on WAN/4G. | :white_check_mark: Fixed |

> [!NOTE]
> For complete technical analyses, CVSS ratings, attack surface diagrams, and automated verification instructions, inspect [`SECURITY.md`](SECURITY.md) and the 7 verification suites in [`tests/`](tests/).

---

## 📸 Architecture & Design Philosophy

PulseBridge is built as an ultra-lightweight native bridge comprising a **Rust native host service (`pulsebridge-server`)**, a **React 19 progressive web app (`pulsebridge-web`)**, a **Model Context Protocol server (`pulsebridge-mcp`)**, and a **VS Code / Cursor extension (`pulsebridge-extension`)**.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        HOST WORKSTATION (WINDOWS)                      │
│                                                                        │
│   ┌──────────────────────────────────────────────────────────────┐     │
│   │              PULSEBRIDGE NATIVE SERVER v2.0 (RUST)           │     │
│   │                                                              │     │
│   │   [Win32 HALFTONE GDI Engine]   [Axum 0.7 REST & WebSocket]  │     │
│   │   • OpenDesktopA("default")     • Sub-millisecond Event Bus  │     │
│   │   • SetProcessDPIAware()        • Constant-time PIN Auth     │     │
│   │   • 150ms HALFTONE Frame Cache  • Socket-Peer Rate Limiting  │     │
│   │   • 48 Extended-Key Scancodes   • /api/inbox Feedback Queue  │     │
│   │   • IsIconic-Safe Window Focus  • Hardware CPU/RAM/Power Mon │     │
│   └───────────────▲──────────────────────────────▲───────────────┘     │
│                   │                              │                     │
│         ┌─────────┴─────────┐          ┌─────────┴─────────┐           │
│         │   AI IDE HOOKS    │          │  MCP SERVER v2.0  │           │
│         │ • Antigravity     │          │ • ask_phone (wait)│           │
│         │ • Cursor AI       │          │ • notify_phone    │           │
│         │ • VS Code / Cline │          │ • update_task     │           │
│         └───────────────────┘          │ • check_inbox     │           │
│                                        └───────────────────┘           │
└───────────────────────────────────▲────────────────────────────────────┘
                                    │ WebSockets & HTTP (LAN)
                                    │ TLS Encrypted via Cloudflare Quick Tunnel (WAN)
┌───────────────────────────────────▼────────────────────────────────────┐
│                  MOBILE COMPANION v2.0 (REACT 19 PWA)                  │
│                                                                        │
│  [Hi-DPI IDE Live Viewport]       [Live Agent Thought & Chat Stream]   │
│  • 2-Finger Pinch Zoom (100-300%) • Streaming Thought & Tool Updates   │
│  • 1:1 Aspect-True Tap & Scroll   • Interactive [OPTIONS] Action Chips │
│  • 48-Key Virtual IDE Deck        • 7d / 30d / All Multi-Project Tree  │
│  • Context-Aware DevOps Runbooks  • Haptic & Audio Milestone Alerts    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## ⚡ Core Capabilities

### 1. 🖥️ Hi-DPI IDE Viewport, 100%–300% Pinch-to-Zoom & 1:1 Input Mapping
- **HALFTONE Native Screen Streaming**: Leverages Windows GDI with DWM desktop attachment (`OpenWindowStationA("WinSta0")` + `SetThreadDesktop` + `SetProcessDPIAware()`) and `HALFTONE` `StretchBlt` scaling. Delivers crisp desktop and single-window captures from an in-memory 150ms frame cache sustaining **160.1 req/sec** under 30-worker concurrent stress testing.
- **2-Finger Pinch-to-Zoom & Docked Preset Bar**: Smoothly pinch-zoom between `100%` and `300%` or tap docked zoom presets (`100%`, `125%`, `150%`, `200%`, `250%`, `300%`) with focal-point preservation and high-contrast 12px gilded scrollbars.
- **Exact 1:1 Coordinate Calibration**: Streamed frames preserve the exact source aspect ratio (`width: ${zoomLevel}%`, `height: auto`), eliminating letterbox offset errors on 16:10, ultrawide, or split-screen IDE windows.
- **Touch Drag/Swipe Remote Mouse Scrolling**: Dragging vertically on the live IDE viewport issues native Win32 `SendInput(MOUSEEVENTF_WHEEL)` scroll events (`delta: ±120`) at the exact cursor coordinates (`x_ratio, y_ratio`) before scrolling, ensuring the hovered editor pane or terminal scrolls reliably.
- **48-Hotkey Virtual Keyboard & Custom Chord Bar**:
  - **Row 1 (Core Editing)**: `Esc`, `Tab`, `Shift+Tab`, `Enter`, `Backspace`, `Delete`, `Ctrl+Z`, `Ctrl+Y`, `Ctrl+S`, `Ctrl+A`, `Ctrl+C`, `Ctrl+V`
  - **Row 2 (Navigation)**: `▲`, `▼`, `◄`, `►`, `Home`, `End`, `PgUp`, `PgDn`, `Ctrl+Home`, `Ctrl+End`, `Ctrl+F`, `Ctrl+G`
  - **Row 3 (AI & Terminal)**: `Ctrl+L` (AI Chat), `Ctrl+K` (Inline AI), `Ctrl+I` (Composer), `Ctrl+\`` (Terminal), `Ctrl+Shift+P` (Command Palette), `Ctrl+P` (Quick Open), `Ctrl+B` (Sidebar), `Ctrl+/` (Comment), `Ctrl+D`, `Alt+Up`, `Alt+Down`
  - **Row 4 (Debug & System)**: `F1`, `F2` (Rename), `F5` (Debug), `F8`, `F9` (Breakpoint), `F10` (Step Over), `F11` (Step Into), `F12` (Go to Def), `Shift+F5`, `Ctrl+Shift+F`, `Ctrl++`, `Ctrl+-`, `Alt+Tab`
  - **Custom Chord Input**: Type any supported combination (e.g., `ctrl+shift+p`, `alt+f4`, `f12`) and dispatch directly.

### 2. 📁 Multi-Project Discovery, 7d / 30d / All Recency & Depth-2 Trees
- **Live Project Auto-Discovery**: Automatically resolves active workspaces across **Google Antigravity** (`%USERPROFILE%\.gemini\antigravity\brain`), **Cursor AI** (`%APPDATA%\Cursor\User\workspaceStorage`), and **VS Code** (`%APPDATA%\Code\User\workspaceStorage`).
- **Workspace & Conversation Dual Resolution**: Seamlessly resolves both workspace-level identifiers and individual conversation UUIDs across `/api/project/chats`, `/api/project/conversation`, and `/api/project/structure`.
- **Interactive 7d / 30d / All Toggle**: Dynamically filters workspaces and conversation history by real filesystem modification timestamps.
- **Live Depth-2 Directory Tree Browser**: Inspect real project directory trees up to depth 2 with expandable folders, file size badges, and automatic exclusion of build artifacts (`node_modules`, `target`, `dist`, `.git`).

### 3. 💬 Bidirectional Agent Feedback, `ask_phone` & Prompt Injection
- **Interactive Decision Chips (`[OPTIONS: ...]`)**: When an agent calls `ask_phone` or outputs structured choices, PulseBridge renders high-contrast, one-tap clickable decision chips in Radiant Gold plus quick-reply chips (`Proceed`, `Run tests`, `Show diff`, `Stop & review`) on the latest agent response.
- **Bidirectional `/api/inbox` Queue**: Mobile replies and decision chip selections are simultaneously injected into the active IDE window and queued in `/api/inbox`, allowing MCP agents (`check_phone_inbox` or blocking `ask_phone`) and the VS Code extension to consume mobile responses deterministically.
- **`IsIconic`-Safe Native Caret Injection**: Attaches to the interactive desktop thread (`AttachThreadInput`), restores the target IDE window **only if minimized** (`IsIconic`), focuses the prompt input, injects Unicode text via `CF_UNICODETEXT`, and submits via hardware scan codes (`MapVirtualKeyW(VK_RETURN)`).
- **Hands-Free Speech-to-Text**: Integrated Web Speech API dictation for voice prompting from your smartphone microphone.

### 4. 🛠️ Context-Aware DevOps Shell Runbooks
- **Allowlisted 1-Tap Runbooks**: Execute `git status -sb`, `git diff --stat`, `git log --oneline -n 5`, `cargo check`, `cargo test`, `npm test`, `npm run build`, and `pytest` directly from the mobile Remote Control drawer.
- **Workspace `cwd` Targeting & Monorepo Auto-Resolution**: Select any discovered project workspace as the working directory (`cwd`); if the workspace root is a parent folder, PulseBridge automatically locates the immediate subfolder containing `Cargo.toml`, `package.json`, or `pyproject.toml`.
- **Full Output Streaming**: Returns combined `stdout`, `stderr`, and exit code directly to the mobile terminal drawer even when a test or linter exits non-zero.

---

## 🎨 Luxury Design Palette

| Swatch | Name | Hex Code | Purpose |
| :---: | :--- | :--- | :--- |
| ![#060907](https://via.placeholder.com/15/060907/000000?text=+) | **Void Obsidian** | `#060907` | Deep contrast background, OLED power efficiency |
| ![#0d140e](https://via.placeholder.com/15/0d140e/000000?text=+) | **Cyber Carbon** | `#0d140e` | Elevated card surfaces and HUD containers |
| ![#eab308](https://via.placeholder.com/15/eab308/000000?text=+) | **Radiant Gold** | `#eab308` | Primary accents, decision chips, zoom & hotkey controls |
| ![#10b981](https://via.placeholder.com/15/10b981/000000?text=+) | **Emerald Green** | `#10b981` | Live connection indicators, verified states |
| ![#34d399](https://via.placeholder.com/15/34d399/000000?text=+) | **Cyber Mint** | `#34d399` | Telemetry HUD values and milestone progress |

---

## 🚀 Quickstart Guide

### Prerequisites
- **Operating System**: Windows 10 / Windows 11 (64-bit)
- **Rust**: 1.75+ (`cargo`)
- **Node.js**: 18+ (`npm`)

### 1. Launch with One Click
Run the included Windows launcher (automatically enables allowlisted DevOps shell runbooks and preserves unrelated local services):
```powershell
.\launch-pulsebridge.bat
```
or via PowerShell with colorized banner and ASCII QR code:
```powershell
.\scripts\start-bridge.ps1 -EnableShellCommands
```

> [!TIP]
> **Smart Port Fallback**: If port `8080` is already in use by another workstation service, `scripts/start-bridge.ps1` never terminates non-PulseBridge processes—it automatically selects fallback port `8765` and updates the pairing QR code accordingly.

### 2. Connect Your Smartphone
- **Local Wi-Fi**: Scan the terminal QR code or navigate to `http://<YOUR_LAN_IP>:8080` in Safari or Chrome.
- **PWA Mode**: Tap **"Add to Home Screen"** on iOS or Android for a full-screen standalone application experience.

---

## 🌐 Testing on 4G/5G Cellular (Outside Wi-Fi)

### Option A: Cloudflare Quick Tunnel (Recommended — End-to-End TLS)
```powershell
cloudflared tunnel --url http://localhost:8080
```
Pass `-TunnelUrl https://<your-subdomain>.trycloudflare.com` to `.\scripts\start-bridge.ps1` to generate a dual LAN + WAN pairing QR code.

### Option B: LocalTunnel
```powershell
npx localtunnel --port 8080
```

### Option C: SSH Reverse Port Forwarding
```powershell
ssh -R 80:localhost:8080 nokey@localhost.run
```

### Option D: Tailscale / WireGuard (Private Mesh VPN)
Access PulseBridge directly via your workstation's `100.x.x.x` Tailscale IP without exposing any public ports.

---

## 🧩 Model Context Protocol (MCP) Integration (`v2.0.0`)

PulseBridge ships with an authenticated MCP server (`pulsebridge-mcp/index.mjs`) that automatically reads the host daemon's session token from `%TEMP%\pulsebridge_tokens.json` (or `PULSEBRIDGE_TOKEN`).

Add this entry to your `mcp.json` or `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pulsebridge": {
      "command": "node",
      "args": ["C:/PulseBridge/pulsebridge-mcp/index.mjs"],
      "env": {
        "PULSEBRIDGE_HOST": "127.0.0.1",
        "PULSEBRIDGE_PORT": "8080"
      }
    }
  }
}
```

### MCP Tools Provided:
- `ask_phone(question, options, level, wait_for_reply?, timeout_secs?)`: Prompts the mobile phone with interactive 1-tap decision chips (e.g., `["Deploy to Prod", "Run Tests First", "Cancel"]`). When `wait_for_reply: true`, polls `/api/inbox` and returns the user's chosen option directly to the agent.
- `notify_phone(title, message, level)`: Dispatches an instant mobile alert with harmonic chime and haptic vibration.
- `update_task_status(task_name, status, progress_percent?, details?)`: Updates the mobile live progress bar and milestone checklist.
- `check_phone_inbox()`: Retrieves and acknowledges unread instructions and decision chip responses queued from the mobile phone via `GET /api/inbox?unread_only=true&ack=true`.

---

## 🔬 Automated Verification & Benchmark Suites (7/7 Passed)

PulseBridge v2.0.0 is validated by **7 comprehensive end-to-end verification suites** in [`tests/`](tests/):

| Test Suite | Scope & Assertions | Verified Result |
| :--- | :--- | :---: |
| [`tests/verify_all.py`](tests/verify_all.py) | 62 assertions covering PWA manifest/SW, Zero-Trust auth, CORS, clipboard sync, coordinate scroll, hotkeys, Eco vs. Retina JPEG stream quality, SVG QR, click simulation, and window enumeration. | **62 / 62 PASSED** |
| [`tests/adversarial_sec_test.py`](tests/adversarial_sec_test.py) | 51 offensive security checks verifying CWE-306 route gating, CWE-78 command injection blocking, CWE-942 CORS origin enforcement, and authenticated action dispatch. | **51 / 51 PASSED** |
| [`tests/test_optin_sandbox.py`](tests/test_optin_sandbox.py) | 14 sandbox assertions testing `--enable-shell-commands` allowlisted execution (`git`, `cargo`, `npm`, `pytest`) and blocking 13 shell chaining/injection vectors (`&`, `;`, `|`, `` ` ``, `$()`, `\n`). | **14 / 14 PASSED** |
| [`tests/stress_test.py`](tests/stress_test.py) | 30-worker concurrent capture & telemetry stress test + brute-force PIN lockout verification on 5th consecutive failed attempt. | **160.1 req/sec (0 drops)** |
| [`tests/test_live_system.py`](tests/test_live_system.py) | End-to-end live host verification across discovered IDE projects, depth-2 directory trees, historical transcripts, coordinate wheel scroll, and cross-IDE prompt dispatch. | **100% PASSED** |
| [`tests/test_multi_project_chats.py`](tests/test_multi_project_chats.py) | Multi-project chat ingestion, project-specific conversation isolation, and zero cross-project bleed verification. | **100% PASSED** |
| [`tests/test_surgical_overhaul.py`](tests/test_surgical_overhaul.py) | v2.0.0 surgical verification: persisted MCP token sync, `active_ide_name` auto-detection, `/api/inbox` unread queue & ack, `ASK_QUESTION` + `tool_calls` preservation, workspace UUID resolution, 48-hotkey normalization, and `cwd` shell execution. | **100% PASSED** |

Run the full verification suite:
```powershell
python tests\verify_all.py
python tests\adversarial_sec_test.py
python tests\test_optin_sandbox.py
python tests\stress_test.py
python tests\test_live_system.py
python tests\test_multi_project_chats.py
python tests\test_surgical_overhaul.py
```

---

## 📁 Repository Structure

```
pulsebridge/
├── pulsebridge-server/        # High-performance Rust backend (Axum 0.7, v2.0.0)
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs            # Server startup, CLI flags, security headers, CORS
│       ├── api.rs             # REST handlers (/api/action, /api/inbox, /api/project/*)
│       ├── auth.rs            # Constant-time PIN, persisted MCP token, peer rate limiter
│       ├── capture.rs         # Win32 HALFTONE GDI screen grabber & 150ms frame cache
│       ├── ingest.rs          # Telemetry ingestion & workspace state synchronization
│       ├── models.rs          # Strongly-typed wire payloads & telemetry structs
│       ├── remote_action.rs   # IsIconic focus, 48 extended-key hotkeys, cwd runbooks
│       ├── state.rs           # Shared state, /api/inbox queue & WebSocket event bus
│       ├── system_telemetry.rs# Host CPU, RAM, Battery & active IDE window detector
│       ├── watchers/          # Real-time parsers for Antigravity, Cursor, VS Code
│       └── ws.rs              # Token-verified WebSocket streaming engine
│
├── pulsebridge-web/           # Mobile-first React 19 + TypeScript + Tailwind v4 PWA (v2.0.0)
│   ├── src/
│   │   ├── components/        # IdePreview (100-300% pinch zoom), ChatStream, RemoteControlDrawer
│   │   ├── hooks/             # usePulseBridge WebSocket & REST hook with haptic feedback
│   │   └── App.tsx
│   └── dist/                  # Production web bundle served directly by Rust
│
├── pulsebridge-mcp/           # Authenticated Model Context Protocol stdio server (v2.0.0)
│   ├── index.mjs              # Tools: ask_phone, notify_phone, update_task_status, check_phone_inbox
│   └── package.json
│
├── pulsebridge-extension/     # Unified VS Code / Cursor companion extension (v2.0.0)
│   └── src/extension.ts
│
├── scripts/
│   ├── start-bridge.bat       # 1-Click Windows Batch launcher
│   ├── start-bridge.ps1       # Smart-port PowerShell launcher with QR display
│   └── setup.ps1              # Full clean rebuild script
│
├── tests/                     # 7 automated SecOps, stress, and E2E verification suites
│   ├── verify_all.py
│   ├── adversarial_sec_test.py
│   ├── test_optin_sandbox.py
│   ├── stress_test.py
│   ├── test_live_system.py
│   ├── test_multi_project_chats.py
│   └── test_surgical_overhaul.py
│
├── ARCHITECTURE.md            # In-depth architectural design specification
├── SECURITY.md                # Zero-Trust security governance & CWE audit remediations
└── README.md                  # Complete v2.0.0 documentation and quickstart
```

---

## 📄 License

PulseBridge is open-source software licensed under the [MIT License](LICENSE).
Created for the modern AI engineering era.
