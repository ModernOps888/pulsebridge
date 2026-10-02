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
    SetCursorPos, SetForegroundWindow, ShowWindow, SW_RESTORE,
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
            return false;
        }
        std::ptr::copy_nonoverlapping(utf16.as_ptr(), ptr, utf16.len());
        GlobalUnlock(hmem);

        if OpenClipboard(0) == 0 {
            return false;
        }
        EmptyClipboard();
        const CF_UNICODETEXT: u32 = 13;
        let res = SetClipboardData(CF_UNICODETEXT, hmem);
        CloseClipboard();
        res != 0
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
    pub key: String, // "ctrl_l", "ctrl_k", "ctrl_s", "ctrl_c", "ctrl_tilde", "esc", "enter", "f5", "tab", "backspace", "delete", "up", "down", "left", "right", "pageup", "pagedown", "ctrl_z", "ctrl_y"
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
            project_name: None,
            conversation_id: None,
            conversation_title: None,
        };
        state.add_chat_step(step);

        // 2. Always persist to inbox for Antigravity & IDE daemons / MCP
        Self::save_to_inbox(&cmd.message, &ide);

        // 3. Handle action mode
        match mode {
            RemoteActionMode::DirectInbox => {
                state.send_alert("info", "Prompt Queued", &format!("Saved to inbox: {}", cmd.message));
                RemoteActionResult {
                    success: true,
                    message: "Prompt queued in inbox successfully".to_string(),
                    target_window: None,
                    stdout: None,
                }
            }
            RemoteActionMode::InjectWindow => {
                let inject_res = Self::inject_prompt_into_ide_window(&cmd.message, &ide).await;
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
                        }
                    }
                }
            }
            RemoteActionMode::LaunchProject => {
                let target_path = cmd.project_path.unwrap_or_else(|| "C:\\".to_string());
                let launch_res = Self::launch_ide_project(&ide, &target_path);
                RemoteActionResult {
                    success: launch_res.is_ok(),
                    message: launch_res.unwrap_or_else(|e| e),
                    target_window: None,
                    stdout: None,
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
                    };
                }

                let exec_res = Self::execute_quick_shell_command(&shell_cmd).await;
                RemoteActionResult {
                    success: exec_res.0,
                    message: "Command execution finished".to_string(),
                    target_window: None,
                    stdout: Some(exec_res.1),
                }
            }
        }
    }

    fn save_to_inbox(message: &str, ide: &IdeSource) {
        let user_profile = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Default".to_string());
        let brain_inbox = Path::new(&user_profile)
            .join(".gemini")
            .join("antigravity")
            .join("brain")
            .join("forge-inbox");

        let _ = fs::create_dir_all(&brain_inbox);
        let filename = format!("{}_mobile_prompt.json", Local::now().format("%Y%m%d_%H%M%S"));
        let target = brain_inbox.join(filename);

        let data = json!({
            "source": "pulsebridge_phone",
            "ide": ide.to_string(),
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
    ) -> Result<String, String> {
        let windows = ScreenCapturer::list_ide_windows();
        let target_window = windows.iter().find(|w| {
            match target_ide {
                IdeSource::Cursor => w.ide == IdeSource::Cursor,
                IdeSource::Antigravity => w.ide == IdeSource::Antigravity,
                IdeSource::VSCode => w.ide == IdeSource::VSCode || w.ide == IdeSource::VisualStudio,
                IdeSource::VisualStudio => w.ide == IdeSource::VisualStudio || w.ide == IdeSource::VSCode,
                IdeSource::Custom => true,
            }
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

        // 2. Perform focus, click, and keystroke injection in a dedicated station-attached OS thread
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

                let foreground_hwnd = GetForegroundWindow();
                let foreground_thread = if foreground_hwnd != 0 {
                    GetWindowThreadProcessId(foreground_hwnd, std::ptr::null_mut())
                } else {
                    0
                };
                let current_thread = GetCurrentThreadId();

                if foreground_thread != 0 && foreground_thread != current_thread {
                    AttachThreadInput(current_thread, foreground_thread, 1);
                }

                ShowWindow(hwnd, SW_RESTORE);
                BringWindowToTop(hwnd);
                SetForegroundWindow(hwnd);

                if foreground_thread != 0 && foreground_thread != current_thread {
                    AttachThreadInput(current_thread, foreground_thread, 0);
                }

                std::thread::sleep(Duration::from_millis(200));

                let mut rect: RECT = std::mem::zeroed();
                GetWindowRect(hwnd, &mut rect);

                if ide_type == IdeSource::Antigravity {
                    // Click into prompt textarea to guarantee caret focus
                    let click_x = rect.left + 350;
                    let click_y = rect.bottom - 75;
                    SetCursorPos(click_x, click_y);
                    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
                    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
                    std::thread::sleep(Duration::from_millis(150));
                } else if ide_type == IdeSource::Cursor || ide_type == IdeSource::VSCode {
                    // Ctrl + L focuses Cursor/VSCode chat composer
                    Self::simulate_combo(&[VK_CONTROL, 0x4C]);
                    std::thread::sleep(Duration::from_millis(150));
                }

                // Simulate Ctrl + V
                Self::simulate_ctrl_v();
                std::thread::sleep(Duration::from_millis(150));

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

    fn create_key_input(vk: u16, key_up: bool) -> INPUT {
        let flags = if key_up { KEYEVENTF_KEYUP } else { 0 };
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
        let cmd_name = match ide {
            IdeSource::Cursor => "cursor",
            IdeSource::VSCode | IdeSource::VisualStudio => "code",
            _ => "code",
        };

        Command::new("powershell")
            .args(["-NoProfile", "-Command", &format!("& {} '{}'", cmd_name, path)])
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
                        // Bring target window to foreground so clicks are delivered directly to it
                        ShowWindow(target_hwnd, SW_RESTORE);
                        SetForegroundWindow(target_hwnd);
                        BringWindowToTop(target_hwnd);
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
                        let w = windows_sys::Win32::UI::WindowsAndMessaging::GetSystemMetrics(windows_sys::Win32::UI::WindowsAndMessaging::SM_CXSCREEN) as f32;
                        let h = windows_sys::Win32::UI::WindowsAndMessaging::GetSystemMetrics(windows_sys::Win32::UI::WindowsAndMessaging::SM_CYSCREEN) as f32;
                        let x = (w * cmd.x_ratio.clamp(0.0, 1.0)).round() as i32;
                        let y = (h * cmd.y_ratio.clamp(0.0, 1.0)).round() as i32;
                        (x, y)
                    }
                } else {
                    let w = windows_sys::Win32::UI::WindowsAndMessaging::GetSystemMetrics(windows_sys::Win32::UI::WindowsAndMessaging::SM_CXSCREEN) as f32;
                    let h = windows_sys::Win32::UI::WindowsAndMessaging::GetSystemMetrics(windows_sys::Win32::UI::WindowsAndMessaging::SM_CYSCREEN) as f32;
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
                        ShowWindow(target_hwnd, SW_RESTORE);
                        SetForegroundWindow(target_hwnd);
                        BringWindowToTop(target_hwnd);
                        std::thread::sleep(Duration::from_millis(30));
                    }
                }

                // If coordinates were specified, reposition cursor first
                if let (Some(xr), Some(yr)) = (cmd.x_ratio, cmd.y_ratio) {
                    let (screen_x, screen_y) = if let Some(hwnd) = cmd.window_id {
                        if hwnd > 0 {
                            let mut rect: RECT = std::mem::zeroed();
                            if GetWindowRect(hwnd as HWND, &mut rect) != 0 {
                                let w = (rect.right - rect.left) as f32;
                                let h = (rect.bottom - rect.top) as f32;
                                let x = rect.left + (w * xr.clamp(0.0, 1.0)).round() as i32;
                                let y = rect.top + (h * yr.clamp(0.0, 1.0)).round() as i32;
                                (x, y)
                            } else {
                                (0, 0)
                            }
                        } else {
                            let w = windows_sys::Win32::UI::WindowsAndMessaging::GetSystemMetrics(windows_sys::Win32::UI::WindowsAndMessaging::SM_CXSCREEN) as f32;
                            let h = windows_sys::Win32::UI::WindowsAndMessaging::GetSystemMetrics(windows_sys::Win32::UI::WindowsAndMessaging::SM_CYSCREEN) as f32;
                            ((w * xr.clamp(0.0, 1.0)).round() as i32, (h * yr.clamp(0.0, 1.0)).round() as i32)
                        }
                    } else {
                        let w = windows_sys::Win32::UI::WindowsAndMessaging::GetSystemMetrics(windows_sys::Win32::UI::WindowsAndMessaging::SM_CXSCREEN) as f32;
                        let h = windows_sys::Win32::UI::WindowsAndMessaging::GetSystemMetrics(windows_sys::Win32::UI::WindowsAndMessaging::SM_CYSCREEN) as f32;
                        ((w * xr.clamp(0.0, 1.0)).round() as i32, (h * yr.clamp(0.0, 1.0)).round() as i32)
                    };

                    if screen_x > 0 || screen_y > 0 {
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

    pub fn simulate_hotkey(hotkey: &str) -> Result<(), String> {
        let key_str = hotkey.to_string();
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

                let res = match key_str.to_lowercase().as_str() {
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
                    "ctrl_z" => {
                        Self::simulate_combo(&[VK_CONTROL, 0x5A]);
                        Ok(())
                    }
                    "ctrl_y" => {
                        Self::simulate_combo(&[VK_CONTROL, 0x59]);
                        Ok(())
                    }
                    "ctrl_a" => {
                        Self::simulate_combo(&[VK_CONTROL, 0x41]);
                        Ok(())
                    }
                    "ctrl_tilde" | "ctrl_`" => {
                        Self::simulate_combo(&[VK_CONTROL, 0xC0]);
                        Ok(())
                    }
                    "esc" => {
                        Self::simulate_key_press(VK_ESCAPE);
                        Ok(())
                    }
                    "enter" => {
                        Self::simulate_key_press(VK_RETURN);
                        Ok(())
                    }
                    "f5" => {
                        Self::simulate_key_press(VK_F5);
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
                    "delete" => {
                        Self::simulate_key_press(0x2E);
                        Ok(())
                    }
                    "up" => {
                        Self::simulate_key_press(0x26);
                        Ok(())
                    }
                    "down" => {
                        Self::simulate_key_press(0x28);
                        Ok(())
                    }
                    "left" => {
                        Self::simulate_key_press(0x25);
                        Ok(())
                    }
                    "right" => {
                        Self::simulate_key_press(0x27);
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

    async fn execute_quick_shell_command(cmd: &str) -> (bool, String) {
        let output = tokio::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", cmd])
            .output()
            .await;

        match output {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                let full = if stderr.is_empty() {
                    stdout
                } else {
                    format!("{stdout}\nSTDERR:\n{stderr}")
                };
                (out.status.success(), full)
            }
            Err(e) => (false, format!("Execution failed: {e}")),
        }
    }

    pub fn is_command_allowlisted(cmd: &str) -> bool {
        let trimmed = cmd.trim();
        // Reject shell command chaining, pipes, redirects, backticks, subshells
        if trimmed.contains('&')
            || trimmed.contains(';')
            || trimmed.contains('|')
            || trimmed.contains('`')
            || trimmed.contains('$')
            || trimmed.contains('>')
            || trimmed.contains('<')
        {
            return false;
        }

        const APPROVED_PREFIXES: &[&str] = &[
            "git status",
            "git diff",
            "git log",
            "git branch",
            "cargo check",
            "cargo test",
            "cargo build",
            "npm test",
            "npm run",
            "pnpm test",
            "yarn test",
            "pytest",
            "python -m pytest",
        ];

        APPROVED_PREFIXES.iter().any(|prefix| trimmed.starts_with(prefix))
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
