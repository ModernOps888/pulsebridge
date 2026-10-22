use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::Duration;
use chrono::Local;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tracing::{info, warn};
use windows_sys::Win32::Foundation::{BOOL, HWND, RECT};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    mouse_event, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
    MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP,
    VK_CONTROL, VK_RETURN, VK_ESCAPE, VK_F5,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId,
    IsIconic, SetCursorPos, SetForegroundWindow, ShowWindow, SW_RESTORE,
};
use windows_sys::Win32::System::Threading::GetCurrentThreadId;

use crate::capture::ScreenCapturer;
use crate::models::{ChatStep, IdeSource};
use crate::state::SharedState;

#[link(name = "user32")]
extern "system" {
    fn AttachThreadInput(idAttach: u32, idAttachTo: u32, fAttach: BOOL) -> BOOL;
    fn OpenClipboard(hWndNewOwner: HWND) -> BOOL;
    fn CloseClipboard() -> BOOL;
    fn EmptyClipboard() -> BOOL;
    fn SetClipboardData(uFormat: u32, hMem: isize) -> isize;
    fn GetClipboardData(uFormat: u32) -> isize;
    fn IsClipboardFormatAvailable(format: u32) -> BOOL;
    fn MapVirtualKeyW(uCode: u32, uMapType: u32) -> u32;
    fn OpenWindowStationA(lpws: *const u8, fInherit: BOOL, dwDesiredAccess: u32) -> isize;
    fn SetProcessWindowStation(hWinSta: isize) -> BOOL;
    fn OpenDesktopA(lpszDesktop: *const u8, dwFlags: u32, fInherit: BOOL, dwDesiredAccess: u32) -> isize;
    fn SetThreadDesktop(hDesktop: isize) -> BOOL;
    fn CloseWindowStation(hWinSta: isize) -> BOOL;
    fn CloseDesktop(hDesktop: isize) -> BOOL;
    fn SetProcessDPIAware() -> BOOL;
}

#[link(name = "kernel32")]
extern "system" {
    fn GlobalAlloc(uFlags: u32, dwBytes: usize) -> isize;
    fn GlobalLock(hMem: isize) -> *mut std::ffi::c_void;
    fn GlobalUnlock(hMem: isize) -> BOOL;
    fn GlobalFree(hMem: isize) -> isize;
}

pub fn set_clipboard_text(text: &str) -> bool {
    let utf16: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let bytes_len = utf16.len() * 2;
    unsafe {
        let hmem = GlobalAlloc(0x0002 /* GMEM_MOVEABLE */, bytes_len);
        if hmem == 0 {
            return false;
        }
        let ptr = GlobalLock(hmem) as *mut u16;
        if ptr.is_null() {
            let _ = GlobalFree(hmem);
            return false;
        }
        std::ptr::copy_nonoverlapping(utf16.as_ptr(), ptr, utf16.len());
        GlobalUnlock(hmem);

        let mut opened = false;
        for _ in 0..5 {
            if OpenClipboard(0) != 0 {
                opened = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        if !opened {
            let _ = GlobalFree(hmem);
            return false;
        }
        EmptyClipboard();
        const CF_UNICODETEXT: u32 = 13;
        let res = SetClipboardData(CF_UNICODETEXT, hmem);
        CloseClipboard();
        if res == 0 {
            let _ = GlobalFree(hmem);
            return false;
        }
        true
    }
}

unsafe fn focus_window_reliable(target_hwnd: HWND) {
    if target_hwnd == 0 {
        return;
    }
    let fg_hwnd = GetForegroundWindow();
    let fg_thread = if fg_hwnd != 0 {
        GetWindowThreadProcessId(fg_hwnd, std::ptr::null_mut())
    } else {
        0
    };
    let cur_thread = GetCurrentThreadId();
    if fg_thread != 0 && fg_thread != cur_thread {
        AttachThreadInput(cur_thread, fg_thread, 1);
    }
    // Only call SW_RESTORE if the window is minimized (iconic), never un-maximize a maximized window!
    if IsIconic(target_hwnd) != 0 {
        ShowWindow(target_hwnd, SW_RESTORE);
    }
    BringWindowToTop(target_hwnd);
    SetForegroundWindow(target_hwnd);
    if fg_thread != 0 && fg_thread != cur_thread {
        AttachThreadInput(cur_thread, fg_thread, 0);
    }
}

pub fn get_clipboard_text() -> Option<String> {
    unsafe {
        const CF_UNICODETEXT: u32 = 13;
        if IsClipboardFormatAvailable(CF_UNICODETEXT) == 0 {
            return None;
        }
        if OpenClipboard(0) == 0 {
            return None;
        }
        let hmem = GetClipboardData(CF_UNICODETEXT);
        if hmem == 0 {
            CloseClipboard();
            return None;
        }
        let ptr = GlobalLock(hmem) as *const u16;
        if ptr.is_null() {
            CloseClipboard();
            return None;
        }
        let mut len = 0;
        while *ptr.add(len) != 0 {
            len += 1;
        }
        let slice = std::slice::from_raw_parts(ptr, len);
        let text = String::from_utf16_lossy(slice);
        GlobalUnlock(hmem);
        CloseClipboard();
        Some(text)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RemoteActionMode {
    DirectInbox,
    InjectWindow,
    LaunchProject,
    ExecuteCommand,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemotePromptCommand {
    pub message: String,
    pub target_ide: Option<IdeSource>,
    pub action_mode: Option<RemoteActionMode>,
    pub project_path: Option<String>,
    pub command: Option<String>,
    #[serde(default)]
    pub project_name: Option<String>,
    #[serde(default)]
    pub conversation_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MouseClickCommand {
    pub window_id: Option<isize>,
    pub x_ratio: f32, // 0.0 to 1.0 (relative to window)
    pub y_ratio: f32, // 0.0 to 1.0
    pub is_right: Option<bool>,
    pub is_double: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HotkeyCommand {
    pub key: String, // "ctrl_l", "ctrl_k", "ctrl_s", "ctrl_c", "ctrl_tilde", "esc", "enter", "f5", "tab", "backspace", "delete", "up", "down", "left", "right", "pageup", "pagedown", "ctrl_z", "ctrl_y", "ctrl_enter", "ctrl_p", "ctrl_shift_p", "ctrl_v"
    pub window_id: Option<isize>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TypeTextCommand {
    pub text: String,
    pub window_id: Option<isize>,
    pub press_enter: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MouseScrollCommand {
    pub window_id: Option<isize>,
    pub delta: i32, // Positive = scroll up, Negative = scroll down (typically 120 or -120)
    pub x_ratio: Option<f32>,
    pub y_ratio: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteActionResult {
    pub success: bool,
    pub message: String,
    pub target_window: Option<String>,
    pub stdout: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stderr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
}

pub struct RemoteActionDispatcher;

impl RemoteActionDispatcher {
    pub async fn dispatch(
        cmd: RemotePromptCommand,
        state: &SharedState,
    ) -> RemoteActionResult {
        let ide = cmd.target_ide.clone().unwrap_or(IdeSource::Antigravity);
        let mode = cmd.action_mode.unwrap_or(RemoteActionMode::InjectWindow);

        info!("RemoteAction: Processing mode {:?} for IDE {:?}", mode, ide);

        // Resolve project metadata if conversation_id or project_name or project_path was provided
        let resolved_proj = cmd
            .conversation_id
            .as_deref()
            .and_then(|cid| state.resolve_project_by_id(cid))
            .or_else(|| {
                cmd.project_name
                    .as_deref()
                    .and_then(|pname| state.resolve_project_by_id(pname))
            });

        let effective_project_name = cmd
            .project_name
            .clone()
            .or_else(|| resolved_proj.as_ref().map(|p| p.project_name.clone()))
            .or_else(|| {
                cmd.project_path.as_deref().and_then(|p| {
                    Path::new(p)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .filter(|s| !s.is_empty())
                        .map(|s| s.to_string())
                })
            });

        let effective_project_path = cmd
            .project_path
            .clone()
            .or_else(|| resolved_proj.as_ref().and_then(|p| p.project_path.clone()))
            .or_else(|| {
                effective_project_name
                    .as_deref()
                    .map(|name| format!("C:\\{}", name))
            });

        // 1. Record in chat stream so phone immediately sees message in chat
        let step = ChatStep {
            id: uuid::Uuid::new_v4().to_string(),
            step_index: state.get_recent_steps().len() as u64 + 1,
            timestamp: Local::now().to_rfc3339(),
            source: "USER".to_string(),
            step_type: "USER_INPUT".to_string(),
            status: "DONE".to_string(),
            content: Some(cmd.message.clone()),
            thinking: None,
            tool_calls: None,
            ide: ide.clone(),
            project_name: effective_project_name.clone(),
            conversation_id: cmd.conversation_id.clone(),
            conversation_title: resolved_proj.as_ref().map(|p| p.conversation_title.clone()),
            input_tokens: None,
            output_tokens: None,
            cache_read_tokens: None,
        };
        state.add_chat_step(step);

        // 2. Persist to inbox for DirectInbox and InjectWindow modes
        if matches!(mode, RemoteActionMode::DirectInbox | RemoteActionMode::InjectWindow) {
            Self::save_to_inbox(
                &cmd.message,
                &ide,
                effective_project_name.as_deref(),
                cmd.conversation_id.as_deref(),
            );
            state.push_inbox_message(
                cmd.message.clone(),
                ide.to_string(),
                effective_project_name.clone(),
                cmd.conversation_id.clone(),
            );
        }

        // 3. Handle action mode
        match mode {
            RemoteActionMode::DirectInbox => {
                state.send_alert("info", "Prompt Queued", &format!("Saved to inbox: {}", cmd.message));
                RemoteActionResult {
                    success: true,
                    message: "Prompt queued in inbox successfully".to_string(),
                    target_window: None,
                    stdout: None,
                    stderr: None,
                    exit_code: None,
                }
            }
            RemoteActionMode::InjectWindow => {
                let inject_res = Self::inject_prompt_into_ide_window(
                    &cmd.message,
                    &ide,
                    effective_project_name.as_deref(),
                )
                .await;
                match inject_res {
                    Ok(win_title) => {
                        state.send_alert(
                            "success",
                            "Prompt Injected into IDE",
                            &format!("Sent to window: {win_title}"),
                        );
                        RemoteActionResult {
                            success: true,
                            message: format!("Successfully pasted and triggered prompt in '{win_title}'"),
                            target_window: Some(win_title),
                            stdout: None,
                            stderr: None,
                            exit_code: None,
                        }
                    }
                    Err(err) => {
                        warn!("Window injection fallback: {err}");
                        state.send_alert("warning", "Window Injection Note", &err);
                        RemoteActionResult {
                            success: true,
                            message: format!("Saved to inbox (Window inject notice: {err})"),
                            target_window: None,
                            stdout: None,
                            stderr: None,
                            exit_code: None,
                        }
                    }
                }
            }
            RemoteActionMode::LaunchProject => {
                let target_path = effective_project_path.unwrap_or_else(|| "C:\\PulseBridge".to_string());
                let launch_res = Self::launch_ide_project(&ide, &target_path);
                let ok = launch_res.is_ok();
                let msg = launch_res.unwrap_or_else(|e| e);
                if ok {
                    state.send_alert("success", "Project Opened", &msg);
                } else {
                    state.send_alert("error", "Project Launch Failed", &msg);
                }
                RemoteActionResult {
                    success: ok,
                    message: msg,
                    target_window: None,
                    stdout: None,
                    stderr: None,
                    exit_code: None,
                }
            }
            RemoteActionMode::ExecuteCommand => {
                if !state.is_shell_command_allowed() {
                    warn!("Blocked ExecuteCommand attempt: remote shell execution is disabled by default.");
                    state.send_alert(
                        "warning",
                        "Security Policy Block",
                        "Remote shell execution is disabled by default for Zero-Trust hardening. Pass --enable-shell-commands to enable.",
                    );
                    return RemoteActionResult {
                        success: false,
                        message: "Security Policy: Remote shell execution is disabled by default. Launch server with --enable-shell-commands to opt in.".to_string(),
                        target_window: None,
                        stdout: None,
                        stderr: None,
                        exit_code: None,
                    };
                }

                let shell_cmd = cmd.command.unwrap_or_else(|| cmd.message.clone());
                if !Self::is_command_allowlisted(&shell_cmd) {
                    warn!("Blocked non-allowlisted shell command: {shell_cmd}");
                    return RemoteActionResult {
                        success: false,
                        message: format!("Security Violation: Command '{shell_cmd}' is not in the approved DevOps allowlist (git, cargo, npm, pnpm, yarn, pytest)."),
                        target_window: None,
                        stdout: None,
                        stderr: None,
                        exit_code: None,
                    };
                }

                let (ok, combined_out, stderr_opt, code_opt, used_dir) =
                    Self::execute_quick_shell_command(&shell_cmd, effective_project_path.as_deref()).await;

                let msg = if ok {
                    format!("Command '{}' succeeded in {}", shell_cmd, used_dir)
                } else {
                    format!(
                        "Command '{}' exited with code {} in {}",
                        shell_cmd,
                        code_opt.unwrap_or(-1),
                        used_dir
                    )
                };

                RemoteActionResult {
                    success: ok,
                    message: msg,
                    target_window: Some(used_dir),
                    stdout: Some(combined_out),
                    stderr: stderr_opt,
                    exit_code: code_opt,
                }
            }
        }
    }

    fn save_to_inbox(
        message: &str,
        ide: &IdeSource,
        project_name: Option<&str>,
        conversation_id: Option<&str>,
    ) {
        let user_profile = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Default".to_string());
        let brain_inbox = Path::new(&user_profile)
            .join(".gemini")
            .join("antigravity")
            .join("brain")
            .join("forge-inbox");

        let _ = fs::create_dir_all(&brain_inbox);
        let filename = format!("{}_mobile_prompt.json", Local::now().format("%Y%m%d_%H%M%S_%3f"));
        let target = brain_inbox.join(filename);

        let data = json!({
            "source": "pulsebridge_phone",
            "ide": ide.to_string(),
            "project_name": project_name,
            "conversation_id": conversation_id,
            "timestamp": Local::now().to_rfc3339(),
            "prompt": message
        });

        let _ = fs::write(target, data.to_string());

        // Also save to PulseBridge local inbox
        let pb_inbox = Path::new("C:\\PulseBridge").join(".inbox");
        let _ = fs::create_dir_all(&pb_inbox);
        let _ = fs::write(pb_inbox.join("latest_prompt.txt"), message);
    }

    async fn inject_prompt_into_ide_window(
        message: &str,
        target_ide: &IdeSource,
        project_hint: Option<&str>,
    ) -> Result<String, String> {
        let windows = ScreenCapturer::list_ide_windows();
        let hint_lower = project_hint.map(|s| s.to_lowercase());

        // 1. Prefer an open window matching both the target IDE and the project name in its title
        let target_window = windows
            .iter()
            .find(|w| {
                let ide_matches = match target_ide {
                    IdeSource::Cursor => w.ide == IdeSource::Cursor,
                    IdeSource::Antigravity => w.ide == IdeSource::Antigravity,
                    IdeSource::VSCode => w.ide == IdeSource::VSCode || w.ide == IdeSource::VisualStudio,
                    IdeSource::VisualStudio => w.ide == IdeSource::VisualStudio || w.ide == IdeSource::VSCode,
                    IdeSource::Custom => true,
                };
                if !ide_matches {
                    return false;
                }
                if let Some(ref h) = hint_lower {
                    w.title.to_lowercase().contains(h)
                } else {
                    true
                }
            })
            .or_else(|| {
                // 2. Fall back to any window matching the target IDE
                windows.iter().find(|w| match target_ide {
                    IdeSource::Cursor => w.ide == IdeSource::Cursor,
                    IdeSource::Antigravity => w.ide == IdeSource::Antigravity,
                    IdeSource::VSCode => w.ide == IdeSource::VSCode || w.ide == IdeSource::VisualStudio,
                    IdeSource::VisualStudio => w.ide == IdeSource::VisualStudio || w.ide == IdeSource::VSCode,
                    IdeSource::Custom => true,
                })
            })
            .or_else(|| {
                // 3. Fall back to any known IDE window (not arbitrary desktop windows)
                windows.iter().find(|w| w.ide != IdeSource::Custom)
            });

        let win = match target_window {
            Some(w) => w,
            None => {
                windows.first().ok_or_else(|| "No active IDE window found to inject into".to_string())?
            }
        };

        let hwnd = win.hwnd as HWND;
        let title = win.title.clone();
        let ide_type = win.ide.clone();
        let msg = message.to_string();

        // 1. Fast native Win32 clipboard copy (with PowerShell fallback)
        if !set_clipboard_text(&msg) {
            let copy_status = Command::new("powershell")
                .args(["-NoProfile", "-Command", &format!("Set-Clipboard -Value @'\n{}\n'@", msg.replace("'", "''"))])
                .status();

            if copy_status.is_err() || !copy_status.unwrap().success() {
                return Err("Failed to copy prompt to clipboard".to_string());
            }
        }

        // 2. Perform focus and keystroke injection in a dedicated station-attached OS thread
        let handle = std::thread::spawn(move || {
            unsafe {
                let winsta = OpenWindowStationA(b"WinSta0\0".as_ptr(), 0, 0x037F);
                if winsta != 0 {
                    SetProcessWindowStation(winsta);
                }
                let desk = OpenDesktopA(b"default\0".as_ptr(), 0, 0, 0x01FF);
                if desk != 0 {
                    SetThreadDesktop(desk);
                }
                let _ = SetProcessDPIAware();

                focus_window_reliable(hwnd);
                std::thread::sleep(Duration::from_millis(180));

                if ide_type == IdeSource::Antigravity
                    || ide_type == IdeSource::Cursor
                    || ide_type == IdeSource::VSCode
                {
                    // Focus composer via Ctrl+L without blind clicking (which can defocus on different panel sizes)
                    Self::simulate_combo(&[VK_CONTROL, 0x4C]);
                    std::thread::sleep(Duration::from_millis(160));
                }

                // Simulate Ctrl + V
                Self::simulate_ctrl_v();
                std::thread::sleep(Duration::from_millis(140));

                // Simulate Enter
                Self::simulate_enter();

                if desk != 0 {
                    CloseDesktop(desk);
                }
                if winsta != 0 {
                    CloseWindowStation(winsta);
                }
            }
        });

        handle.join().map_err(|_| "Injection thread error".to_string())?;

        Ok(title)
    }

    unsafe fn simulate_ctrl_v() {
        let mut inputs = [
            // Ctrl down
            Self::create_key_input(VK_CONTROL, false),
            // 'V' down (0x56)
            Self::create_key_input(0x56, false),
            // 'V' up
            Self::create_key_input(0x56, true),
            // Ctrl up
            Self::create_key_input(VK_CONTROL, true),
        ];

        SendInput(
            inputs.len() as u32,
            inputs.as_mut_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        );
    }

    unsafe fn simulate_enter() {
        let mut inputs = [
            Self::create_key_input(VK_RETURN, false),
            Self::create_key_input(VK_RETURN, true),
        ];

        SendInput(
            inputs.len() as u32,
            inputs.as_mut_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        );
    }

    fn is_extended_key(vk: u16) -> bool {
        matches!(
            vk,
            0x21..=0x28 // PGUP, PGDN, END, HOME, LEFT, UP, RIGHT, DOWN
            | 0x2C..=0x2E // SNAPSHOT, INSERT, DELETE
            | 0x5B..=0x5D // LWIN, RWIN, APPS
            | 0x6F // VK_DIVIDE
            | 0x90 // VK_NUMLOCK
            | 0xA3 | 0xA5 // VK_RCONTROL, VK_RMENU
        )
    }

    fn create_key_input(vk: u16, key_up: bool) -> INPUT {
        const KEYEVENTF_EXTENDEDKEY: u32 = 0x0001;
        let mut flags = if key_up { KEYEVENTF_KEYUP } else { 0 };
        if Self::is_extended_key(vk) {
            flags |= KEYEVENTF_EXTENDEDKEY;
        }
        let scan = unsafe { MapVirtualKeyW(vk as u32, 0) as u16 };
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: scan,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    fn launch_ide_project(ide: &IdeSource, path: &str) -> Result<String, String> {
        let proj_folder_name = Path::new(path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(path)
            .to_lowercase();

        // 1. Check if an IDE window with this project folder name is already open; if so, focus it immediately
        let windows = ScreenCapturer::list_ide_windows();
        if let Some(existing_win) = windows.iter().find(|w| {
            let ide_ok = match ide {
                IdeSource::Antigravity => w.ide == IdeSource::Antigravity,
                IdeSource::Cursor => w.ide == IdeSource::Cursor,
                IdeSource::VSCode => w.ide == IdeSource::VSCode,
                IdeSource::VisualStudio => w.ide == IdeSource::VisualStudio,
                IdeSource::Custom => true,
            };
            ide_ok && !proj_folder_name.is_empty() && w.title.to_lowercase().contains(&proj_folder_name)
        }) {
            let hwnd = existing_win.hwnd as HWND;
            let title = existing_win.title.clone();
            let _ = std::thread::spawn(move || unsafe {
                let _ = SetProcessDPIAware();
                focus_window_reliable(hwnd);
            })
            .join();
            return Ok(format!("Focused active {ide} window: '{title}'"));
        }

        // 2. Otherwise spawn the target IDE binary safely with path as direct argument (no shell injection)
        let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let candidates: Vec<String> = match ide {
            IdeSource::Antigravity => vec![
                format!("{}\\Programs\\Antigravity\\Antigravity.exe", local_app_data),
                "antigravity.cmd".to_string(),
                "agy.cmd".to_string(),
                "code.cmd".to_string(),
            ],
            IdeSource::Cursor => vec![
                format!("{}\\Programs\\cursor\\Cursor.exe", local_app_data),
                "cursor.cmd".to_string(),
                "cursor".to_string(),
            ],
            IdeSource::VisualStudio => vec![
                "devenv.exe".to_string(),
                "code.cmd".to_string(),
            ],
            IdeSource::VSCode | IdeSource::Custom => vec![
                format!("{}\\Programs\\Microsoft VS Code\\Code.exe", local_app_data),
                "code.cmd".to_string(),
                "code".to_string(),
            ],
        };

        for bin in &candidates {
            if Command::new(bin).arg(path).spawn().is_ok() {
                return Ok(format!("Opened project '{path}' in {ide}"));
            }
        }

        // Fallback via cmd /c start if CLI shims are in user PATH
        let cmd_name = match ide {
            IdeSource::Antigravity => "antigravity",
            IdeSource::Cursor => "cursor",
            IdeSource::VisualStudio => "devenv",
            IdeSource::VSCode | IdeSource::Custom => "code",
        };
        Command::new("cmd")
            .args(["/C", cmd_name, path])
            .spawn()
            .map_err(|e| format!("Failed to spawn {cmd_name}: {e}"))?;

        Ok(format!("Opened project '{path}' in {ide}"))
    }

    pub fn simulate_click(cmd: MouseClickCommand) -> Result<(), String> {
        let handle = std::thread::spawn(move || {
            unsafe {
                let winsta = OpenWindowStationA(b"WinSta0\0".as_ptr(), 0, 0x037F);
                if winsta != 0 {
                    SetProcessWindowStation(winsta);
                }
                let desk = OpenDesktopA(b"default\0".as_ptr(), 0, 0, 0x01FF);
                if desk != 0 {
                    SetThreadDesktop(desk);
                }
                let _ = SetProcessDPIAware();

                let (screen_x, screen_y) = if let Some(hwnd) = cmd.window_id {
                    if hwnd > 0 {
                        let target_hwnd = hwnd as HWND;
                        // Bring target window to foreground without un-maximizing maximized windows
                        focus_window_reliable(target_hwnd);
                        std::thread::sleep(Duration::from_millis(40));

                        let mut rect: RECT = std::mem::zeroed();
                        if GetWindowRect(target_hwnd, &mut rect) != 0 {
                            let w = (rect.right - rect.left) as f32;
                            let h = (rect.bottom - rect.top) as f32;
                            let x = rect.left + (w * cmd.x_ratio.clamp(0.0, 1.0)).round() as i32;
                            let y = rect.top + (h * cmd.y_ratio.clamp(0.0, 1.0)).round() as i32;
                            (x, y)
                        } else {
                            return Err("Failed to get window rect".to_string());
                        }
                    } else {
                        let w = windows_sys::Win32::UI::WindowsAndMessaging::GetSystemMetrics(windows_sys::Win32::UI::WindowsAndMessaging::SM_CXSCREEN).max(800) as f32;
                        let h = windows_sys::Win32::UI::WindowsAndMessaging::GetSystemMetrics(windows_sys::Win32::UI::WindowsAndMessaging::SM_CYSCREEN).max(600) as f32;
                        let x = (w * cmd.x_ratio.clamp(0.0, 1.0)).round() as i32;
                        let y = (h * cmd.y_ratio.clamp(0.0, 1.0)).round() as i32;
                        (x, y)
                    }
                } else {
                    let w = windows_sys::Win32::UI::WindowsAndMessaging::GetSystemMetrics(windows_sys::Win32::UI::WindowsAndMessaging::SM_CXSCREEN).max(800) as f32;
                    let h = windows_sys::Win32::UI::WindowsAndMessaging::GetSystemMetrics(windows_sys::Win32::UI::WindowsAndMessaging::SM_CYSCREEN).max(600) as f32;
                    let x = (w * cmd.x_ratio.clamp(0.0, 1.0)).round() as i32;
                    let y = (h * cmd.y_ratio.clamp(0.0, 1.0)).round() as i32;
                    (x, y)
                };

                // Move cursor to calibrated coordinates
                SetCursorPos(screen_x, screen_y);
                // Crucial delay: allows Windows DWM hit-testing engine to register cursor at position before firing click
                std::thread::sleep(Duration::from_millis(30));

                let is_right = cmd.is_right.unwrap_or(false);
                let is_double = cmd.is_double.unwrap_or(false);

                if is_right {
                    mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0);
                    std::thread::sleep(Duration::from_millis(20));
                    mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0);
                } else {
                    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
                    std::thread::sleep(Duration::from_millis(20));
                    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
                    if is_double {
                        std::thread::sleep(Duration::from_millis(60));
                        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
                        std::thread::sleep(Duration::from_millis(20));
                        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
                    }
                }

                if desk != 0 {
                    CloseDesktop(desk);
                }
                if winsta != 0 {
                    CloseWindowStation(winsta);
                }

                Ok(())
            }
        });

        handle.join().map_err(|_| "Click thread panicked".to_string())?
    }

    pub fn simulate_scroll(cmd: MouseScrollCommand) -> Result<(), String> {
        let handle = std::thread::spawn(move || {
            unsafe {
                let winsta = OpenWindowStationA(b"WinSta0\0".as_ptr(), 0, 0x037F);
                if winsta != 0 {
                    SetProcessWindowStation(winsta);
                }
                let desk = OpenDesktopA(b"default\0".as_ptr(), 0, 0, 0x01FF);
                if desk != 0 {
                    SetThreadDesktop(desk);
                }
                let _ = SetProcessDPIAware();

                if let Some(hwnd) = cmd.window_id {
                    if hwnd > 0 {
                        let target_hwnd = hwnd as HWND;
                        focus_window_reliable(target_hwnd);
                        std::thread::sleep(Duration::from_millis(30));
                    }
                }

                // Reposition cursor over target region (supports negative multi-monitor coordinates)
                let ratios = match (cmd.x_ratio, cmd.y_ratio) {
                    (Some(xr), Some(yr)) => Some((xr, yr)),
                    _ if cmd.window_id.filter(|&h| h > 0).is_some() => Some((0.5, 0.5)),
                    _ => None,
                };

                if let Some((xr, yr)) = ratios {
                    let target_pos: Option<(i32, i32)> = if let Some(hwnd) = cmd.window_id {
                        if hwnd > 0 {
                            let mut rect: RECT = std::mem::zeroed();
                            if GetWindowRect(hwnd as HWND, &mut rect) != 0 {
                                let w = (rect.right - rect.left) as f32;
                                let h = (rect.bottom - rect.top) as f32;
                                let x = rect.left + (w * xr.clamp(0.0, 1.0)).round() as i32;
                                let y = rect.top + (h * yr.clamp(0.0, 1.0)).round() as i32;
                                Some((x, y))
                            } else {
                                None
                            }
                        } else {
                            let w = windows_sys::Win32::UI::WindowsAndMessaging::GetSystemMetrics(windows_sys::Win32::UI::WindowsAndMessaging::SM_CXSCREEN).max(800) as f32;
                            let h = windows_sys::Win32::UI::WindowsAndMessaging::GetSystemMetrics(windows_sys::Win32::UI::WindowsAndMessaging::SM_CYSCREEN).max(600) as f32;
                            Some(((w * xr.clamp(0.0, 1.0)).round() as i32, (h * yr.clamp(0.0, 1.0)).round() as i32))
                        }
                    } else {
                        let w = windows_sys::Win32::UI::WindowsAndMessaging::GetSystemMetrics(windows_sys::Win32::UI::WindowsAndMessaging::SM_CXSCREEN).max(800) as f32;
                        let h = windows_sys::Win32::UI::WindowsAndMessaging::GetSystemMetrics(windows_sys::Win32::UI::WindowsAndMessaging::SM_CYSCREEN).max(600) as f32;
                        Some(((w * xr.clamp(0.0, 1.0)).round() as i32, (h * yr.clamp(0.0, 1.0)).round() as i32))
                    };

                    if let Some((screen_x, screen_y)) = target_pos {
                        SetCursorPos(screen_x, screen_y);
                        std::thread::sleep(Duration::from_millis(20));
                    }
                }

                const MOUSEEVENTF_WHEEL: u32 = 0x0800;
                mouse_event(MOUSEEVENTF_WHEEL, 0, 0, cmd.delta, 0);

                if desk != 0 {
                    CloseDesktop(desk);
                }
                if winsta != 0 {
                    CloseWindowStation(winsta);
                }

                Ok(())
            }
        });

        handle.join().map_err(|_| "Scroll thread panicked".to_string())?
    }

    pub fn simulate_type_text(cmd: TypeTextCommand) -> Result<(), String> {
        if !set_clipboard_text(&cmd.text) {
            return Err("Failed to set workstation clipboard for typing".to_string());
        }

        let target_hwnd_opt = cmd.window_id.filter(|&h| h > 0);
        let press_enter = cmd.press_enter.unwrap_or(true);

        let handle = std::thread::spawn(move || {
            unsafe {
                let winsta = OpenWindowStationA(b"WinSta0\0".as_ptr(), 0, 0x037F);
                if winsta != 0 {
                    SetProcessWindowStation(winsta);
                }
                let desk = OpenDesktopA(b"default\0".as_ptr(), 0, 0, 0x01FF);
                if desk != 0 {
                    SetThreadDesktop(desk);
                }
                let _ = SetProcessDPIAware();

                if let Some(hwnd) = target_hwnd_opt {
                    let target_hwnd = hwnd as HWND;
                    if GetForegroundWindow() != target_hwnd {
                        focus_window_reliable(target_hwnd);
                        std::thread::sleep(Duration::from_millis(60));
                    }
                }

                Self::simulate_ctrl_v();
                if press_enter {
                    std::thread::sleep(Duration::from_millis(80));
                    Self::simulate_enter();
                }

                if desk != 0 {
                    CloseDesktop(desk);
                }
                if winsta != 0 {
                    CloseWindowStation(winsta);
                }
                Ok(())
            }
        });

        handle.join().map_err(|_| "Type text thread panicked".to_string())?
    }

    pub fn trigger_emergency_stop() -> Result<String, String> {
        let windows = ScreenCapturer::list_ide_windows();
        let target_win = windows
            .iter()
            .find(|w| w.ide != IdeSource::Custom)
            .or_else(|| windows.first())
            .cloned();

        let handle = std::thread::spawn(move || {
            unsafe {
                let winsta = OpenWindowStationA(b"WinSta0\0".as_ptr(), 0, 0x037F);
                if winsta != 0 {
                    SetProcessWindowStation(winsta);
                }
                let desk = OpenDesktopA(b"default\0".as_ptr(), 0, 0, 0x01FF);
                if desk != 0 {
                    SetThreadDesktop(desk);
                }
                let _ = SetProcessDPIAware();

                let mut win_label = "Foreground Window".to_string();
                if let Some(win) = target_win {
                    win_label = win.title.clone();
                    let target_hwnd = win.hwnd as HWND;
                    focus_window_reliable(target_hwnd);
                    std::thread::sleep(Duration::from_millis(50));
                }

                // Send Esc + Ctrl+C to halt active generation or terminal execution
                Self::simulate_key_press(VK_ESCAPE);
                std::thread::sleep(Duration::from_millis(40));
                Self::simulate_combo(&[VK_CONTROL, 0x43]);

                if desk != 0 {
                    CloseDesktop(desk);
                }
                if winsta != 0 {
                    CloseWindowStation(winsta);
                }

                Ok(win_label)
            }
        });

        handle.join().map_err(|_| "Emergency stop thread panicked".to_string())?
    }

    pub fn simulate_hotkey(hotkey: &str, window_id: Option<isize>) -> Result<(), String> {
        let key_str = hotkey.trim().to_string();
        let target_hwnd_opt = window_id.filter(|&h| h > 0).or_else(|| {
            let wins = ScreenCapturer::list_ide_windows();
            wins.iter()
                .find(|w| w.ide != IdeSource::Custom)
                .or_else(|| wins.first())
                .map(|w| w.hwnd)
        });

        let handle = std::thread::spawn(move || {
            unsafe {
                let winsta = OpenWindowStationA(b"WinSta0\0".as_ptr(), 0, 0x037F);
                if winsta != 0 {
                    SetProcessWindowStation(winsta);
                }
                let desk = OpenDesktopA(b"default\0".as_ptr(), 0, 0, 0x01FF);
                if desk != 0 {
                    SetThreadDesktop(desk);
                }
                let _ = SetProcessDPIAware();

                if let Some(hwnd) = target_hwnd_opt {
                    let target_hwnd = hwnd as HWND;
                    if GetForegroundWindow() != target_hwnd {
                        focus_window_reliable(target_hwnd);
                        std::thread::sleep(Duration::from_millis(40));
                    }
                }

                let normalized = key_str.to_lowercase().replace('+', "_").replace('-', "_");
                const VK_SHIFT: u16 = 0x10;
                const VK_MENU: u16 = 0x12; // Alt

                let res = match normalized.as_str() {
                    "ctrl_l" => {
                        Self::simulate_combo(&[VK_CONTROL, 0x4C]);
                        Ok(())
                    }
                    "ctrl_k" => {
                        Self::simulate_combo(&[VK_CONTROL, 0x4B]);
                        Ok(())
                    }
                    "ctrl_s" => {
                        Self::simulate_combo(&[VK_CONTROL, 0x53]);
                        Ok(())
                    }
                    "ctrl_c" => {
                        Self::simulate_combo(&[VK_CONTROL, 0x43]);
                        Ok(())
                    }
                    "ctrl_v" => {
                        Self::simulate_combo(&[VK_CONTROL, 0x56]);
                        Ok(())
                    }
                    "ctrl_x" => {
                        Self::simulate_combo(&[VK_CONTROL, 0x58]);
                        Ok(())
                    }
                    "ctrl_z" => {
                        Self::simulate_combo(&[VK_CONTROL, 0x5A]);
                        Ok(())
                    }
                    "ctrl_y" | "ctrl_shift_z" => {
                        Self::simulate_combo(&[VK_CONTROL, 0x59]);
                        Ok(())
                    }
                    "ctrl_a" => {
                        Self::simulate_combo(&[VK_CONTROL, 0x41]);
                        Ok(())
                    }
                    "ctrl_p" => {
                        Self::simulate_combo(&[VK_CONTROL, 0x50]);
                        Ok(())
                    }
                    "ctrl_b" => {
                        Self::simulate_combo(&[VK_CONTROL, 0x42]);
                        Ok(())
                    }
                    "ctrl_j" => {
                        Self::simulate_combo(&[VK_CONTROL, 0x4A]);
                        Ok(())
                    }
                    "ctrl_f" => {
                        Self::simulate_combo(&[VK_CONTROL, 0x46]);
                        Ok(())
                    }
                    "ctrl_h" => {
                        Self::simulate_combo(&[VK_CONTROL, 0x48]);
                        Ok(())
                    }
                    "ctrl_w" => {
                        Self::simulate_combo(&[VK_CONTROL, 0x57]);
                        Ok(())
                    }
                    "ctrl_n" => {
                        Self::simulate_combo(&[VK_CONTROL, 0x4E]);
                        Ok(())
                    }
                    "ctrl_d" => {
                        Self::simulate_combo(&[VK_CONTROL, 0x44]);
                        Ok(())
                    }
                    "ctrl_shift_p" | "f1" => {
                        Self::simulate_combo(&[VK_CONTROL, VK_SHIFT, 0x50]);
                        Ok(())
                    }
                    "ctrl_shift_f" => {
                        Self::simulate_combo(&[VK_CONTROL, VK_SHIFT, 0x46]);
                        Ok(())
                    }
                    "ctrl_shift_e" => {
                        Self::simulate_combo(&[VK_CONTROL, VK_SHIFT, 0x45]);
                        Ok(())
                    }
                    "ctrl_shift_g" => {
                        Self::simulate_combo(&[VK_CONTROL, VK_SHIFT, 0x47]);
                        Ok(())
                    }
                    "ctrl_shift_x" => {
                        Self::simulate_combo(&[VK_CONTROL, VK_SHIFT, 0x58]);
                        Ok(())
                    }
                    "ctrl_shift_k" => {
                        Self::simulate_combo(&[VK_CONTROL, VK_SHIFT, 0x4B]);
                        Ok(())
                    }
                    "ctrl_shift_tilde" | "ctrl_shift_`" => {
                        Self::simulate_combo(&[VK_CONTROL, VK_SHIFT, 0xC0]);
                        Ok(())
                    }
                    "ctrl_enter" => {
                        Self::simulate_combo(&[VK_CONTROL, VK_RETURN]);
                        Ok(())
                    }
                    "shift_enter" => {
                        Self::simulate_combo(&[VK_SHIFT, VK_RETURN]);
                        Ok(())
                    }
                    "shift_tab" => {
                        Self::simulate_combo(&[VK_SHIFT, 0x09]);
                        Ok(())
                    }
                    "alt_tab" => {
                        Self::simulate_combo(&[VK_MENU, 0x09]);
                        Ok(())
                    }
                    "alt_z" => {
                        Self::simulate_combo(&[VK_MENU, 0x5A]);
                        Ok(())
                    }
                    "alt_up" => {
                        Self::simulate_combo(&[VK_MENU, 0x26]);
                        Ok(())
                    }
                    "alt_down" => {
                        Self::simulate_combo(&[VK_MENU, 0x28]);
                        Ok(())
                    }
                    "ctrl_home" => {
                        Self::simulate_combo(&[VK_CONTROL, 0x24]);
                        Ok(())
                    }
                    "ctrl_end" => {
                        Self::simulate_combo(&[VK_CONTROL, 0x23]);
                        Ok(())
                    }
                    "ctrl_slash" | "ctrl_/" => {
                        Self::simulate_combo(&[VK_CONTROL, 0xBF]);
                        Ok(())
                    }
                    "ctrl_tilde" | "ctrl_`" => {
                        Self::simulate_combo(&[VK_CONTROL, 0xC0]);
                        Ok(())
                    }
                    "esc" | "escape" => {
                        Self::simulate_key_press(VK_ESCAPE);
                        Ok(())
                    }
                    "enter" | "return" => {
                        Self::simulate_key_press(VK_RETURN);
                        Ok(())
                    }
                    "space" => {
                        Self::simulate_key_press(0x20);
                        Ok(())
                    }
                    "f2" => {
                        Self::simulate_key_press(0x71);
                        Ok(())
                    }
                    "f3" => {
                        Self::simulate_key_press(0x72);
                        Ok(())
                    }
                    "f4" => {
                        Self::simulate_key_press(0x73);
                        Ok(())
                    }
                    "f5" => {
                        Self::simulate_key_press(VK_F5);
                        Ok(())
                    }
                    "f6" => {
                        Self::simulate_key_press(0x75);
                        Ok(())
                    }
                    "f7" => {
                        Self::simulate_key_press(0x76);
                        Ok(())
                    }
                    "f8" => {
                        Self::simulate_key_press(0x77);
                        Ok(())
                    }
                    "f9" => {
                        Self::simulate_key_press(0x78);
                        Ok(())
                    }
                    "f10" => {
                        Self::simulate_key_press(0x79);
                        Ok(())
                    }
                    "f11" => {
                        Self::simulate_key_press(0x7A);
                        Ok(())
                    }
                    "f12" => {
                        Self::simulate_key_press(0x7B);
                        Ok(())
                    }
                    "tab" => {
                        Self::simulate_key_press(0x09);
                        Ok(())
                    }
                    "backspace" => {
                        Self::simulate_key_press(0x08);
                        Ok(())
                    }
                    "insert" => {
                        Self::simulate_key_press(0x2D);
                        Ok(())
                    }
                    "delete" => {
                        Self::simulate_key_press(0x2E);
                        Ok(())
                    }
                    "up" | "arrow_up" => {
                        Self::simulate_key_press(0x26);
                        Ok(())
                    }
                    "down" | "arrow_down" => {
                        Self::simulate_key_press(0x28);
                        Ok(())
                    }
                    "left" | "arrow_left" => {
                        Self::simulate_key_press(0x25);
                        Ok(())
                    }
                    "right" | "arrow_right" => {
                        Self::simulate_key_press(0x27);
                        Ok(())
                    }
                    "home" => {
                        Self::simulate_key_press(0x24);
                        Ok(())
                    }
                    "end" => {
                        Self::simulate_key_press(0x23);
                        Ok(())
                    }
                    "pageup" | "page_up" => {
                        Self::simulate_key_press(0x21);
                        Ok(())
                    }
                    "pagedown" | "page_down" => {
                        Self::simulate_key_press(0x22);
                        Ok(())
                    }
                    _ => Err(format!("Unsupported hotkey: {key_str}")),
                };

                if desk != 0 {
                    CloseDesktop(desk);
                }
                if winsta != 0 {
                    CloseWindowStation(winsta);
                }

                res
            }
        });

        handle.join().map_err(|_| "Hotkey thread panicked".to_string())?
    }

    unsafe fn simulate_combo(keys: &[u16]) {
        for &k in keys {
            let mut inp = [Self::create_key_input(k, false)];
            SendInput(1, inp.as_mut_ptr(), std::mem::size_of::<INPUT>() as i32);
        }
        std::thread::sleep(Duration::from_millis(30));
        for &k in keys.iter().rev() {
            let mut inp = [Self::create_key_input(k, true)];
            SendInput(1, inp.as_mut_ptr(), std::mem::size_of::<INPUT>() as i32);
        }
    }

    unsafe fn simulate_key_press(vk: u16) {
        let mut inputs = [
            Self::create_key_input(vk, false),
            Self::create_key_input(vk, true),
        ];
        SendInput(
            inputs.len() as u32,
            inputs.as_mut_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        );
    }

    async fn execute_quick_shell_command(
        cmd: &str,
        cwd_hint: Option<&str>,
    ) -> (bool, String, Option<String>, Option<i32>, String) {
        let trimmed = cmd.trim();
        let mut work_dir = cwd_hint
            .map(Path::new)
            .filter(|p| p.exists() && p.is_dir())
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| {
                let pb = Path::new("C:\\PulseBridge");
                if pb.exists() {
                    pb.to_path_buf()
                } else {
                    std::env::current_dir().unwrap_or_else(|_| Path::new("C:\\").to_path_buf())
                }
            });

        // Smart sub-workspace resolution for monorepos (e.g., C:\PulseBridge -> pulsebridge-server / pulsebridge-web)
        if trimmed.starts_with("cargo ") && !work_dir.join("Cargo.toml").exists() {
            let sub_server = work_dir.join("pulsebridge-server");
            if sub_server.join("Cargo.toml").exists() {
                work_dir = sub_server;
            } else if let Ok(entries) = fs::read_dir(&work_dir) {
                for entry in entries.flatten() {
                    if entry.path().is_dir() && entry.path().join("Cargo.toml").exists() {
                        work_dir = entry.path();
                        break;
                    }
                }
            }
        } else if (trimmed.starts_with("npm ") || trimmed.starts_with("pnpm ") || trimmed.starts_with("yarn "))
            && !work_dir.join("package.json").exists()
        {
            let sub_web = work_dir.join("pulsebridge-web");
            let sub_fe = work_dir.join("frontend");
            if sub_web.join("package.json").exists() {
                work_dir = sub_web;
            } else if sub_fe.join("package.json").exists() {
                work_dir = sub_fe;
            } else if let Ok(entries) = fs::read_dir(&work_dir) {
                for entry in entries.flatten() {
                    if entry.path().is_dir() && entry.path().join("package.json").exists() {
                        work_dir = entry.path();
                        break;
                    }
                }
            }
        }

        let used_dir_str = work_dir.to_string_lossy().to_string();

        let output = tokio::process::Command::new("powershell")
            .current_dir(&work_dir)
            .args(["-NoProfile", "-Command", trimmed])
            .output()
            .await;

        match output {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                let full = if stderr.trim().is_empty() {
                    stdout.clone()
                } else if stdout.trim().is_empty() {
                    stderr.clone()
                } else {
                    format!("{stdout}\nSTDERR:\n{stderr}")
                };
                let stderr_opt = if stderr.trim().is_empty() {
                    None
                } else {
                    Some(stderr)
                };
                (
                    out.status.success(),
                    full,
                    stderr_opt,
                    out.status.code(),
                    used_dir_str,
                )
            }
            Err(e) => (
                false,
                format!("Execution failed: {e}"),
                Some(e.to_string()),
                Some(-1),
                used_dir_str,
            ),
        }
    }

    pub fn is_command_allowlisted(cmd: &str) -> bool {
        let trimmed = cmd.trim();
        // Reject shell command chaining, pipes, redirects, backticks, subshells, and multiline injections
        if trimmed.contains('&')
            || trimmed.contains(';')
            || trimmed.contains('|')
            || trimmed.contains('`')
            || trimmed.contains('$')
            || trimmed.contains('>')
            || trimmed.contains('<')
            || trimmed.contains('\n')
            || trimmed.contains('\r')
        {
            return false;
        }

        const APPROVED_PREFIXES: &[&str] = &[
            "git status",
            "git diff",
            "git log",
            "git branch",
            "git pull",
            "git fetch",
            "git show",
            "cargo check",
            "cargo test",
            "cargo build",
            "cargo clippy",
            "cargo --version",
            "rustc --version",
            "npm test",
            "npm run",
            "npm --version",
            "node --version",
            "pnpm test",
            "pnpm run",
            "yarn test",
            "yarn run",
            "pytest",
            "python -m pytest",
            "python --version",
        ];

        APPROVED_PREFIXES.iter().any(|prefix| {
            trimmed == *prefix
                || (trimmed.starts_with(prefix)
                    && trimmed.as_bytes().get(prefix.len()) == Some(&b' '))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_native_clipboard() {
        let msg = "PulseBridge Test Prompt: 100% Reliable 🚀";
        let ok = set_clipboard_text(msg);
        assert!(ok, "Native clipboard copy should succeed");
    }
}
