use std::io::Cursor;
use std::time::{Duration, Instant};
use image::{codecs::jpeg::JpegEncoder, ColorType};
use parking_lot::Mutex;
use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM, RECT};
use windows_sys::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
    GetDIBits, ReleaseDC, SelectObject, StretchBlt, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    SRCCOPY,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetSystemMetrics, GetWindowRect, GetWindowTextW,
    IsIconic, IsWindowVisible, SM_CXSCREEN, SM_CYSCREEN,
};
use crate::models::{IdeSource, IdeWindowInfo};

static LAST_DESKTOP_CACHE: Mutex<Option<(Instant, u8, Vec<u8>)>> = Mutex::new(None);

#[link(name = "user32")]
extern "system" {
    fn OpenWindowStationA(
        lpws: *const u8,
        fInherit: BOOL,
        dwDesiredAccess: u32,
    ) -> isize;
    fn SetProcessWindowStation(hWinSta: isize) -> BOOL;
    fn OpenDesktopA(
        lpszDesktop: *const u8,
        dwFlags: u32,
        fInherit: BOOL,
        dwDesiredAccess: u32,
    ) -> isize;
    fn SetThreadDesktop(hDesktop: isize) -> BOOL;
    fn CloseWindowStation(hWinSta: isize) -> BOOL;
    fn CloseDesktop(hDesktop: isize) -> BOOL;
    fn SetProcessDPIAware() -> BOOL;
}

pub struct ScreenCapturer;

struct WindowEnumContext {
    windows: Vec<IdeWindowInfo>,
}

fn get_process_name_by_pid(pid: u32) -> Option<String> {
    if pid == 0 {
        return None;
    }
    unsafe {
        let handle = windows_sys::Win32::System::Threading::OpenProcess(
            windows_sys::Win32::System::Threading::PROCESS_QUERY_LIMITED_INFORMATION,
            0,
            pid,
        );
        if handle == 0 {
            return None;
        }

        let mut buf = [0u16; 1024];
        let mut size = 1024u32;
        let success = windows_sys::Win32::System::Threading::QueryFullProcessImageNameW(
            handle,
            0,
            buf.as_mut_ptr(),
            &mut size,
        );
        windows_sys::Win32::Foundation::CloseHandle(handle);

        if success != 0 && size > 0 {
            let full_path = String::from_utf16_lossy(&buf[..size as usize]);
            let exe_name = std::path::Path::new(&full_path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            Some(exe_name)
        } else {
            None
        }
    }
}

unsafe extern "system" fn enum_windows_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let context = &mut *(lparam as *mut WindowEnumContext);

    if IsWindowVisible(hwnd) == 0 {
        return 1;
    }

    let is_minimized = IsIconic(hwnd) != 0;

    let mut title_buf = [0u16; 512];
    let len = GetWindowTextW(hwnd, title_buf.as_mut_ptr(), 512);
    if len <= 0 {
        return 1;
    }

    let title = String::from_utf16_lossy(&title_buf[..len as usize]);
    let title_lower = title.to_lowercase();

    // Check process name
    let mut pid = 0u32;
    windows_sys::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(hwnd, &mut pid);
    let proc_name = get_process_name_by_pid(pid).unwrap_or_default().to_lowercase();

    // Filter out internal system and overlay windows
    if title_lower.contains("geforce overlay")
        || title_lower == "program manager"
        || title_lower == "windows input experience"
        || title_lower == "msctfime ui"
        || title_lower == "default ime"
    {
        return 1;
    }

    // Check if it belongs to Cursor, VS Code, Antigravity, or Visual Studio
    let detected_ide = if proc_name.contains("antigravity") || title_lower.contains("antigravity") {
        Some(IdeSource::Antigravity)
    } else if proc_name.contains("cursor") || title_lower.contains("cursor") {
        Some(IdeSource::Cursor)
    } else if proc_name.contains("code") || title_lower.contains("visual studio code") || title_lower.contains(" - code") {
        Some(IdeSource::VSCode)
    } else if proc_name.contains("devenv") || title_lower.contains("visual studio") {
        Some(IdeSource::VisualStudio)
    } else {
        Some(IdeSource::Custom)
    };

    if let Some(ide) = detected_ide {
        let mut rect: RECT = std::mem::zeroed();
        GetWindowRect(hwnd, &mut rect);
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;

        if width > 120 && height > 120 {
            context.windows.push(IdeWindowInfo {
                hwnd: hwnd as isize,
                title,
                ide,
                width,
                height,
                is_minimized,
            });
        }
    }

    1
}

impl ScreenCapturer {
    pub fn list_ide_windows() -> Vec<IdeWindowInfo> {
        let handle = std::thread::spawn(|| {
            unsafe {
                let _ = SetProcessDPIAware();
                let winsta = OpenWindowStationA(b"WinSta0\0".as_ptr(), 0, 0x037F);
                if winsta != 0 {
                    SetProcessWindowStation(winsta);
                }
                let desk = OpenDesktopA(b"default\0".as_ptr(), 0, 0, 0x01FF);
                if desk != 0 {
                    SetThreadDesktop(desk);
                }

                let mut context = WindowEnumContext {
                    windows: Vec::new(),
                };

                EnumWindows(
                    Some(enum_windows_callback),
                    &mut context as *mut WindowEnumContext as LPARAM,
                );

                if desk != 0 {
                    CloseDesktop(desk);
                }
                if winsta != 0 {
                    CloseWindowStation(winsta);
                }

                // Sort: Primary IDEs first, then custom
                context.windows.sort_by_key(|w| match w.ide {
                    IdeSource::Antigravity => 0,
                    IdeSource::Cursor => 1,
                    IdeSource::VSCode => 2,
                    IdeSource::VisualStudio => 3,
                    IdeSource::Custom => 4,
                });

                context.windows
            }
        });

        handle.join().unwrap_or_default()
    }

    pub fn capture_desktop(quality: u8) -> Result<Vec<u8>, String> {
        {
            let cache = LAST_DESKTOP_CACHE.lock();
            if let Some((instant, q, ref bytes)) = *cache {
                if instant.elapsed() < Duration::from_millis(150) && q == quality {
                    return Ok(bytes.clone());
                }
            }
        }

        let handle = std::thread::spawn(move || {
            unsafe {
                let _ = SetProcessDPIAware();
                let winsta = OpenWindowStationA(b"WinSta0\0".as_ptr(), 0, 0x037F);
                if winsta != 0 {
                    SetProcessWindowStation(winsta);
                }
                let desk = OpenDesktopA(b"default\0".as_ptr(), 0, 0, 0x01FF);
                if desk != 0 {
                    SetThreadDesktop(desk);
                }

                let width = GetSystemMetrics(SM_CXSCREEN).max(800);
                let height = GetSystemMetrics(SM_CYSCREEN).max(600);

                let res = Self::capture_hwnd_internal(0, 0, 0, width, height, quality);

                if desk != 0 {
                    CloseDesktop(desk);
                }
                if winsta != 0 {
                    CloseWindowStation(winsta);
                }

                res
            }
        });

        match handle.join() {
            Ok(Ok(bytes)) => {
                let mut cache = LAST_DESKTOP_CACHE.lock();
                *cache = Some((Instant::now(), quality, bytes.clone()));
                Ok(bytes)
            }
            Ok(Err(err)) => {
                tracing::warn!("Native GDI capture error: {err}. Falling back to virtual canvas.");
                Self::generate_ide_canvas(1280, 720, quality)
            }
            Err(_) => {
                tracing::warn!("Capture thread panicked. Falling back to virtual canvas.");
                Self::generate_ide_canvas(1280, 720, quality)
            }
        }
    }

    pub fn capture_window(hwnd: isize, quality: u8) -> Result<Vec<u8>, String> {
        let handle = std::thread::spawn(move || {
            unsafe {
                let _ = SetProcessDPIAware();
                let winsta = OpenWindowStationA(b"WinSta0\0".as_ptr(), 0, 0x037F);
                if winsta != 0 {
                    SetProcessWindowStation(winsta);
                }
                let desk = OpenDesktopA(b"default\0".as_ptr(), 0, 0, 0x01FF);
                if desk != 0 {
                    SetThreadDesktop(desk);
                }

                let hwnd_target = hwnd as HWND;
                let res = if hwnd_target == 0 {
                    let width = GetSystemMetrics(SM_CXSCREEN).max(800);
                    let height = GetSystemMetrics(SM_CYSCREEN).max(600);
                    Self::capture_hwnd_internal(0, 0, 0, width, height, quality)
                } else {
                    let mut rect: RECT = std::mem::zeroed();
                    if GetWindowRect(hwnd_target, &mut rect) == 0 {
                        let width = GetSystemMetrics(SM_CXSCREEN).max(800);
                        let height = GetSystemMetrics(SM_CYSCREEN).max(600);
                        Self::capture_hwnd_internal(0, 0, 0, width, height, quality)
                    } else {
                        let width = rect.right - rect.left;
                        let height = rect.bottom - rect.top;

                        if width <= 0 || height <= 0 {
                            let w = GetSystemMetrics(SM_CXSCREEN).max(800);
                            let h = GetSystemMetrics(SM_CYSCREEN).max(600);
                            Self::capture_hwnd_internal(0, 0, 0, w, h, quality)
                        } else {
                            Self::capture_hwnd_internal(0, rect.left, rect.top, width, height, quality)
                        }
                    }
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

        match handle.join() {
            Ok(Ok(bytes)) => Ok(bytes),
            Ok(Err(err)) => {
                tracing::warn!("Native window capture error: {err}. Using canvas fallback.");
                Self::generate_ide_canvas(1280, 720, quality)
            }
            Err(_) => Self::generate_ide_canvas(1280, 720, quality),
        }
    }

    pub fn generate_ide_canvas(width: u32, height: u32, quality: u8) -> Result<Vec<u8>, String> {
        let w = width.clamp(640, 2560);
        let h = height.clamp(480, 1440);
        let mut img = image::RgbImage::new(w, h);

        // Fill IDE dark background #181a1f
        for pixel in img.pixels_mut() {
            *pixel = image::Rgb([24, 26, 31]);
        }

        // Top bar #21252b (height 38px)
        for y in 0..38.min(h) {
            for x in 0..w {
                img.put_pixel(x, y, image::Rgb([33, 37, 43]));
            }
        }

        // Active tab #282c34 (width 200px, height 34px)
        for y in 4..38.min(h) {
            for x in 4..204.min(w) {
                img.put_pixel(x, y, image::Rgb([40, 44, 52]));
            }
        }

        // Left sidebar #1e2227 (width 220px)
        for y in 38..h {
            for x in 0..220.min(w) {
                img.put_pixel(x, y, image::Rgb([30, 34, 39]));
            }
        }

        // Bottom status bar #007acc (height 24px)
        for y in (h.saturating_sub(24))..h {
            for x in 0..w {
                img.put_pixel(x, y, image::Rgb([0, 122, 204]));
            }
        }

        let mut jpeg_buf = Vec::new();
        let mut cursor = Cursor::new(&mut jpeg_buf);
        let q = quality.clamp(20, 95);
        let mut encoder = JpegEncoder::new_with_quality(&mut cursor, q);
        encoder
            .encode(img.as_raw(), w, h, ColorType::Rgb8)
            .map_err(|e| format!("JPEG fallback error: {e}"))?;

        Ok(jpeg_buf)
    }

    unsafe fn capture_hwnd_internal(
        hwnd: HWND,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        quality: u8,
    ) -> Result<Vec<u8>, String> {
        let hdc_screen = GetDC(hwnd);
        if hdc_screen == 0 {
            return Err("Failed to get device context".to_string());
        }

        let hdc_mem = CreateCompatibleDC(hdc_screen);
        if hdc_mem == 0 {
            ReleaseDC(hwnd, hdc_screen);
            return Err("Failed to create compatible memory DC".to_string());
        }

        // Scale resolution for mobile optimization if 4K or ultra-wide
        let max_w = 1920;
        let max_h = 1080;
        let (out_w, out_h) = if width > max_w || height > max_h {
            let scale = (max_w as f32 / width as f32).min(max_h as f32 / height as f32);
            let sw = ((width as f32 * scale).round() as i32).max(640);
            let sh = ((height as f32 * scale).round() as i32).max(360);
            (sw, sh)
        } else {
            (width, height)
        };

        let hbitmap = CreateCompatibleBitmap(hdc_screen, out_w, out_h);
        if hbitmap == 0 {
            DeleteDC(hdc_mem);
            ReleaseDC(hwnd, hdc_screen);
            return Err("Failed to create compatible bitmap".to_string());
        }

        let old_bitmap = SelectObject(hdc_mem, hbitmap);
        let blt_result = if out_w == width && out_h == height {
            BitBlt(hdc_mem, 0, 0, width, height, hdc_screen, x, y, SRCCOPY)
        } else {
            StretchBlt(hdc_mem, 0, 0, out_w, out_h, hdc_screen, x, y, width, height, SRCCOPY)
        };

        if blt_result == 0 {
            SelectObject(hdc_mem, old_bitmap);
            DeleteObject(hbitmap);
            DeleteDC(hdc_mem);
            ReleaseDC(hwnd, hdc_screen);
            return Err("GDI BitBlt/StretchBlt screen copy failed".to_string());
        }

        let mut bmi: BITMAPINFO = std::mem::zeroed();
        bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bmi.bmiHeader.biWidth = out_w;
        bmi.bmiHeader.biHeight = -out_h; // Top-down DIB
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = BI_RGB;

        let total_pixels = (out_w * out_h) as usize;
        let mut raw_pixels = vec![0u8; total_pixels * 4];

        let get_di_res = GetDIBits(
            hdc_mem,
            hbitmap,
            0,
            out_h as u32,
            raw_pixels.as_mut_ptr() as *mut _,
            &mut bmi,
            DIB_RGB_COLORS,
        );

        // Cleanup GDI objects immediately
        SelectObject(hdc_mem, old_bitmap);
        DeleteObject(hbitmap);
        DeleteDC(hdc_mem);
        ReleaseDC(hwnd, hdc_screen);

        if get_di_res == 0 {
            return Err("GetDIBits failed to extract pixel data".to_string());
        }

        // Convert BGRA to RGB for JPEG encoding
        let mut rgb_pixels = Vec::with_capacity(total_pixels * 3);
        for chunk in raw_pixels.chunks_exact(4) {
            let b = chunk[0];
            let g = chunk[1];
            let r = chunk[2];
            rgb_pixels.push(r);
            rgb_pixels.push(g);
            rgb_pixels.push(b);
        }

        // Encode as JPEG into memory buffer
        let mut jpeg_buf = Vec::new();
        let mut cursor = Cursor::new(&mut jpeg_buf);
        let q = quality.clamp(20, 95);
        let mut encoder = JpegEncoder::new_with_quality(&mut cursor, q);
        encoder
            .encode(
                &rgb_pixels,
                out_w as u32,
                out_h as u32,
                ColorType::Rgb8,
            )
            .map_err(|e| format!("JPEG encoding error: {e}"))?;

        Ok(jpeg_buf)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_windows() {
        let windows = ScreenCapturer::list_ide_windows();
        println!("Discovered {} windows", windows.len());
        for w in &windows {
            println!("HWND: {} | IDE: {:?} | Title: {}", w.hwnd, w.ide, w.title);
        }
        assert!(!windows.is_empty(), "Should discover active desktop windows");
    }

    #[test]
    fn test_capture_desktop_live() {
        let capture = ScreenCapturer::capture_desktop(70);
        assert!(capture.is_ok(), "Desktop capture should succeed");
        let bytes = capture.unwrap();
        println!("Captured desktop JPEG size: {} bytes", bytes.len());
        assert!(bytes.len() > 10_000, "Real desktop capture should be > 10KB");
        // Save test capture for inspection
        let _ = std::fs::write("C:\\PulseBridge\\test_rust_capture.jpg", &bytes);
    }
}
