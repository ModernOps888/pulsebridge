use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::json;
use crate::capture::ScreenCapturer;
use crate::models::{ChatStep, IdeWindowInfo};
use crate::state::SharedState;

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub pin: String,
}

#[derive(Debug, Deserialize)]
pub struct FrameQuery {
    pub window_id: Option<isize>,
    pub quality: Option<u8>,
    pub token: Option<String>,
}

use axum::extract::ConnectInfo;
use std::net::SocketAddr;

#[derive(Debug, Deserialize)]
pub struct AuthHeaderQuery {
    pub token: Option<String>,
    pub project: Option<String>,
    pub conversation_id: Option<String>,
    pub path: Option<String>,
    pub depth: Option<usize>,
    pub days: Option<u64>,
    pub max_age_days: Option<u64>,
}

pub async fn login_handler(
    State(state): State<SharedState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(payload): Json<LoginRequest>,
) -> impl IntoResponse {
    // Key rate limiter on physical socket peer IP to prevent spoofing.
    // Only inspect CF-Connecting-IP / X-Forwarded-For if connection is from local proxy (loopback).
    let client_ip = if addr.ip().is_loopback() {
        headers
            .get("cf-connecting-ip")
            .or_else(|| headers.get("x-forwarded-for"))
            .and_then(|h| h.to_str().ok())
            .and_then(|s| s.split(',').next())
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| addr.ip().to_string())
    } else {
        addr.ip().to_string()
    };

    match state.auth().verify_pin_and_issue_token(&client_ip, &payload.pin) {
        Ok(token) => (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "token": token,
                "message": "Authentication successful"
            })),
        ),
        Err(err) => (
            StatusCode::UNAUTHORIZED,
            Json(json!({
                "success": false,
                "message": err
            })),
        ),
    }
}

#[derive(Debug, Deserialize)]
pub struct QrCodeQuery {
    pub mode: Option<String>,
}

pub async fn qr_code_handler(
    State(state): State<SharedState>,
    Query(query): Query<QrCodeQuery>,
) -> impl IntoResponse {
    match state.auth().get_qr_svg(query.mode.as_deref()) {
        Ok(svg) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "image/svg+xml")],
            svg,
        ),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            [(header::CONTENT_TYPE, "text/plain")],
            format!("Error generating QR: {err}"),
        ),
    }
}

pub async fn status_handler(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Query(query): Query<AuthHeaderQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    verify_auth(&state, &headers, query.token.as_deref())?;

    let task = state.get_task_progress();
    let telemetry = state.get_telemetry();
    let windows = ScreenCapturer::list_ide_windows();

    Ok(Json(json!({
        "task": task,
        "telemetry": telemetry,
        "windows": windows
    })))
}

pub async fn chat_steps_handler(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Query(query): Query<AuthHeaderQuery>,
) -> Result<Json<Vec<ChatStep>>, StatusCode> {
    verify_auth(&state, &headers, query.token.as_deref())?;

    let days = query.days.or(query.max_age_days).unwrap_or(30);
    let cutoff_millis = chrono::Utc::now().timestamp_millis() - (days as i64 * 24 * 3600 * 1000);

    if let Some(ref cid) = query.conversation_id {
        let mem = state.get_recent_steps_filtered(query.project.as_deref(), Some(cid));
        if !mem.is_empty() {
            let filtered: Vec<ChatStep> = mem.into_iter().filter(|s| {
                if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&s.timestamp) {
                    dt.timestamp_millis() >= cutoff_millis
                } else {
                    true
                }
            }).collect();
            return Ok(Json(filtered));
        }
        // Load on-demand from disk if not in memory
        let disk_steps = load_historical_steps_for_conversation(cid, days);
        if !disk_steps.is_empty() {
            return Ok(Json(disk_steps));
        }
    }

    if query.project.is_some() {
        let list = state.get_recent_steps_filtered(
            query.project.as_deref(),
            query.conversation_id.as_deref(),
        );
        let filtered: Vec<ChatStep> = list.into_iter().filter(|s| {
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&s.timestamp) {
                dt.timestamp_millis() >= cutoff_millis
            } else {
                true
            }
        }).collect();
        Ok(Json(filtered))
    } else {
        let list = state.get_recent_steps();
        let filtered: Vec<ChatStep> = list.into_iter().filter(|s| {
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&s.timestamp) {
                dt.timestamp_millis() >= cutoff_millis
            } else {
                true
            }
        }).collect();
        Ok(Json(filtered))
    }
}

pub async fn project_structure_handler(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Query(query): Query<AuthHeaderQuery>,
) -> Result<Json<crate::models::ProjectStructureResponse>, StatusCode> {
    verify_auth(&state, &headers, query.token.as_deref())?;

    let req_project = query.project.as_deref().or(query.path.as_deref()).unwrap_or("PulseBridge");
    let target_dir = resolve_project_directory(req_project);
    let proj_name = target_dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| req_project.to_string());
    let root_path_str = target_dir.to_string_lossy().to_string();

    let max_depth = query.depth.unwrap_or(2).min(3);
    let entries = scan_directory_tree(&target_dir, &target_dir, max_depth, 0);

    Ok(Json(crate::models::ProjectStructureResponse {
        project_name: proj_name,
        root_path: root_path_str,
        entries,
    }))
}

fn resolve_project_directory(input: &str) -> std::path::PathBuf {
    let p = std::path::Path::new(input);
    if p.is_absolute() && p.exists() && p.is_dir() {
        return p.to_path_buf();
    }

    // Try relative to C:\
    let c_path = std::path::Path::new("C:\\").join(input);
    if c_path.exists() && c_path.is_dir() {
        return c_path;
    }

    // Check case-insensitive match in C:\
    if let Ok(entries) = std::fs::read_dir("C:\\") {
        for entry in entries.flatten() {
            if let Ok(file_type) = entry.file_type() {
                if file_type.is_dir() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.eq_ignore_ascii_case(input) {
                        return entry.path();
                    }
                }
            }
        }
    }

    // Fallback to C:\PulseBridge
    std::path::PathBuf::from("C:\\PulseBridge")
}

fn scan_directory_tree(
    root: &std::path::Path,
    current: &std::path::Path,
    max_depth: usize,
    depth: usize,
) -> Vec<crate::models::ProjectFileEntry> {
    if depth >= max_depth || !current.exists() {
        return Vec::new();
    }

    let mut entries = Vec::new();
    let read_res = match std::fs::read_dir(current) {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };

    let ignored_names = [
        ".git", "node_modules", "target", "dist", ".gemini", "__pycache__",
        ".venv", ".next", ".turbo", "build", "out", ".idea", ".vscode", "tmp", "temp"
    ];

    let mut dir_items = Vec::new();
    let mut file_items = Vec::new();

    for entry in read_res.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || ignored_names.iter().any(|&ign| ign.eq_ignore_ascii_case(&name)) {
            continue;
        }

        let full_path = entry.path();
        let is_dir = full_path.is_dir();
        let rel_path = full_path.strip_prefix(root)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| name.clone());
        let size = if is_dir { 0 } else { entry.metadata().map(|m| m.len()).unwrap_or(0) };

        if is_dir {
            dir_items.push((name, rel_path, full_path, size));
        } else {
            file_items.push((name, rel_path, full_path, size));
        }
    }

    dir_items.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
    file_items.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));

    for (name, rel_path, full_path, size) in dir_items.into_iter().take(30) {
        let children = if depth + 1 < max_depth {
            Some(scan_directory_tree(root, &full_path, max_depth, depth + 1))
        } else {
            None
        };
        entries.push(crate::models::ProjectFileEntry {
            name,
            relative_path: rel_path,
            is_dir: true,
            size,
            children,
        });
    }

    for (name, rel_path, _full_path, size) in file_items.into_iter().take(40) {
        entries.push(crate::models::ProjectFileEntry {
            name,
            relative_path: rel_path,
            is_dir: false,
            size,
            children: None,
        });
    }

    entries
}

fn load_historical_steps_for_conversation(conv_id: &str, max_age_days: u64) -> Vec<ChatStep> {
    let user_profile = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Default".to_string());
    let transcript = std::path::Path::new(&user_profile)
        .join(".gemini")
        .join("antigravity")
        .join("brain")
        .join(conv_id)
        .join(".system_generated")
        .join("logs")
        .join("transcript.jsonl");

    let cutoff_millis = chrono::Utc::now().timestamp_millis() - (max_age_days as i64 * 24 * 3600 * 1000);

    let mut steps = Vec::new();
    if let Ok(file) = std::fs::File::open(&transcript) {
        use std::io::BufRead;
        let reader = std::io::BufReader::new(file);
        for line in reader.lines().flatten() {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
                    if let Some(step) = crate::watchers::antigravity::AntigravityWatcher::parse_json_step(&v, conv_id) {
                        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&step.timestamp) {
                            if dt.timestamp_millis() >= cutoff_millis {
                                steps.push(step);
                            }
                        } else {
                            steps.push(step);
                        }
                    }
                }
            }
        }
    }
    steps
}

pub async fn list_projects_handler(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Query(query): Query<AuthHeaderQuery>,
) -> Result<Json<Vec<crate::models::ProjectChatInfo>>, StatusCode> {
    verify_auth(&state, &headers, query.token.as_deref())?;
    let days = query.days.or(query.max_age_days).unwrap_or(30);
    Ok(Json(state.get_project_chats_filtered(Some(days))))
}

pub async fn list_windows_handler(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Query(query): Query<AuthHeaderQuery>,
) -> Result<Json<Vec<IdeWindowInfo>>, StatusCode> {
    verify_auth(&state, &headers, query.token.as_deref())?;
    Ok(Json(ScreenCapturer::list_ide_windows()))
}

pub async fn preview_frame_handler(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Query(query): Query<FrameQuery>,
) -> Result<Response, StatusCode> {
    verify_auth(&state, &headers, query.token.as_deref())?;

    let quality = query.quality.unwrap_or(65);
    let jpeg_bytes = match query.window_id {
        Some(hwnd) if hwnd > 0 => ScreenCapturer::capture_window(hwnd, quality),
        _ => ScreenCapturer::capture_desktop(quality),
    };

    match jpeg_bytes {
        Ok(bytes) => {
            let mut response = bytes.into_response();
            response.headers_mut().insert(
                header::CONTENT_TYPE,
                header::HeaderValue::from_static("image/jpeg"),
            );
            response.headers_mut().insert(
                header::CACHE_CONTROL,
                header::HeaderValue::from_static("no-store, no-cache, must-revalidate"),
            );
            Ok(response)
        }
        Err(err) => {
            tracing::error!("Screen capture error: {}", err);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub fn verify_auth(
    state: &SharedState,
    headers: &HeaderMap,
    query_token: Option<&str>,
) -> Result<(), StatusCode> {
    // 1. Check query token
    if let Some(tok) = query_token {
        if state.auth().is_token_valid(tok) {
            return Ok(());
        }
    }

    // 2. Check Authorization Bearer header
    if let Some(auth_val) = headers.get(header::AUTHORIZATION) {
        if let Ok(auth_str) = auth_val.to_str() {
            if auth_str.starts_with("Bearer ") {
                let token = &auth_str[7..];
                if state.auth().is_token_valid(token) {
                    return Ok(());
                }
            }
        }
    }

    Err(StatusCode::UNAUTHORIZED)
}
