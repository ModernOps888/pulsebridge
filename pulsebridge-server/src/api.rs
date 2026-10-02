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

#[derive(Debug, Deserialize)]
pub struct AuthHeaderQuery {
    pub token: Option<String>,
}

pub async fn login_handler(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(payload): Json<LoginRequest>,
) -> impl IntoResponse {
    let client_ip = headers
        .get("x-forwarded-for")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("127.0.0.1")
        .to_string();

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

pub async fn qr_code_handler(State(state): State<SharedState>) -> impl IntoResponse {
    match state.auth().get_qr_svg() {
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
    Ok(Json(state.get_recent_steps()))
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

fn verify_auth(
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
