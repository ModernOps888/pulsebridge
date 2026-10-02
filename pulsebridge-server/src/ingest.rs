use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use chrono::Local;
use serde::Deserialize;
use serde_json::json;
use tracing::info;
use uuid::Uuid;
use crate::api::{verify_auth, AuthHeaderQuery};
use crate::models::{ChatStep, IdeSource, ToolCallInfo};
use crate::state::SharedState;

#[derive(Debug, Deserialize)]
pub struct IngestEventPayload {
    pub ide: Option<String>,
    pub event_type: String, // "step", "status", "milestone", "alert"
    pub content: Option<String>,
    pub thinking: Option<String>,
    pub tool_name: Option<String>,
    pub tool_action: Option<String>,
    pub task_title: Option<String>,
    pub percent_complete: Option<u8>,
    pub status: Option<String>,
    pub project_name: Option<String>,
    pub conversation_id: Option<String>,
    pub conversation_title: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SendPromptPayload {
    pub message: String,
    pub target_ide: Option<String>,
    pub target_project: Option<String>,
}

pub async fn handle_ingest_event(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Query(query): Query<AuthHeaderQuery>,
    Json(payload): Json<IngestEventPayload>,
) -> Result<impl IntoResponse, StatusCode> {
    verify_auth(&state, &headers, query.token.as_deref())?;

    let ide_source = match payload.ide.as_deref().unwrap_or("custom").to_lowercase().as_str() {
        "cursor" => IdeSource::Cursor,
        "antigravity" => IdeSource::Antigravity,
        "vscode" => IdeSource::VSCode,
        "visualstudio" | "visual studio" => IdeSource::VisualStudio,
        _ => IdeSource::Custom,
    };

    if let Some(title) = payload.task_title {
        state.update_task_progress(|p| {
            p.task_title = title;
            p.active_ide = ide_source.clone();
            if let Some(percent) = payload.percent_complete {
                p.percent_complete = percent;
            }
        });
    }

    if payload.event_type == "alert" {
        state.send_alert(
            payload.status.as_deref().unwrap_or("info"),
            &format!("Alert from {}", ide_source),
            payload.content.as_deref().unwrap_or(""),
        );
        return Ok((StatusCode::OK, Json(json!({ "status": "alert_broadcasted" }))));
    }

    let tool_calls = if let Some(tname) = payload.tool_name {
        Some(vec![ToolCallInfo {
            tool_name: tname,
            action: payload.tool_action.unwrap_or_else(|| "Running".to_string()),
            summary: payload.content.clone().unwrap_or_default(),
            arguments: None,
            output: None,
        }])
    } else {
        None
    };

    let step = ChatStep {
        id: Uuid::new_v4().to_string(),
        step_index: state.get_recent_steps().len() as u64 + 1,
        timestamp: Local::now().to_rfc3339(),
        source: "MODEL".to_string(),
        step_type: "EVENT".to_string(),
        status: payload.status.unwrap_or_else(|| "DONE".to_string()),
        content: payload.content,
        thinking: payload.thinking,
        tool_calls,
        ide: ide_source,
        project_name: payload.project_name,
        conversation_id: payload.conversation_id,
        conversation_title: payload.conversation_title,
    };

    state.add_chat_step(step);
    Ok((StatusCode::OK, Json(json!({ "status": "ingested" }))))
}

pub async fn handle_send_prompt(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Query(query): Query<AuthHeaderQuery>,
    Json(payload): Json<SendPromptPayload>,
) -> Result<impl IntoResponse, StatusCode> {
    verify_auth(&state, &headers, query.token.as_deref())?;

    info!("Received prompt from mobile client: {}", payload.message);

    let ide_source = payload.target_ide.as_deref().map(|s| match s.to_lowercase().as_str() {
        "cursor" => IdeSource::Cursor,
        "antigravity" => IdeSource::Antigravity,
        "vscode" => IdeSource::VSCode,
        "visualstudio" | "visual studio" => IdeSource::VisualStudio,
        _ => IdeSource::Antigravity,
    });

    let cmd = crate::remote_action::RemotePromptCommand {
        message: payload.message,
        target_ide: ide_source,
        action_mode: Some(crate::remote_action::RemoteActionMode::InjectWindow),
        project_path: None,
        command: None,
    };

    let result = crate::remote_action::RemoteActionDispatcher::dispatch(cmd, &state).await;
    Ok((StatusCode::OK, Json(result)))
}

pub async fn handle_remote_action(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Query(query): Query<AuthHeaderQuery>,
    Json(payload): Json<crate::remote_action::RemotePromptCommand>,
) -> Result<impl IntoResponse, StatusCode> {
    verify_auth(&state, &headers, query.token.as_deref())?;

    let result = crate::remote_action::RemoteActionDispatcher::dispatch(payload, &state).await;
    Ok((StatusCode::OK, Json(result)))
}

pub async fn handle_mouse_click(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Query(query): Query<AuthHeaderQuery>,
    Json(payload): Json<crate::remote_action::MouseClickCommand>,
) -> Result<impl IntoResponse, StatusCode> {
    verify_auth(&state, &headers, query.token.as_deref())?;

    match crate::remote_action::RemoteActionDispatcher::simulate_click(payload) {
        Ok(_) => Ok((StatusCode::OK, Json(json!({ "success": true })))),
        Err(e) => Ok((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "success": false, "error": e })))),
    }
}

pub async fn handle_hotkey(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Query(query): Query<AuthHeaderQuery>,
    Json(payload): Json<crate::remote_action::HotkeyCommand>,
) -> Result<impl IntoResponse, StatusCode> {
    verify_auth(&state, &headers, query.token.as_deref())?;

    match crate::remote_action::RemoteActionDispatcher::simulate_hotkey(&payload.key) {
        Ok(_) => Ok((StatusCode::OK, Json(json!({ "success": true })))),
        Err(e) => Ok((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "success": false, "error": e })))),
    }
}

pub async fn handle_mouse_scroll(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Query(query): Query<AuthHeaderQuery>,
    Json(payload): Json<crate::remote_action::MouseScrollCommand>,
) -> Result<impl IntoResponse, StatusCode> {
    verify_auth(&state, &headers, query.token.as_deref())?;

    match crate::remote_action::RemoteActionDispatcher::simulate_scroll(payload) {
        Ok(_) => Ok((StatusCode::OK, Json(json!({ "success": true })))),
        Err(e) => Ok((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "success": false, "error": e })))),
    }
}

#[derive(Debug, serde::Deserialize)]
pub struct ClipboardPayload {
    pub text: String,
}

pub async fn handle_get_clipboard(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Query(query): Query<AuthHeaderQuery>,
) -> Result<impl IntoResponse, StatusCode> {
    verify_auth(&state, &headers, query.token.as_deref())?;

    let text = crate::remote_action::get_clipboard_text().unwrap_or_default();
    Ok((StatusCode::OK, Json(json!({ "success": true, "text": text }))))
}

pub async fn handle_set_clipboard(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Query(query): Query<AuthHeaderQuery>,
    Json(payload): Json<ClipboardPayload>,
) -> Result<impl IntoResponse, StatusCode> {
    verify_auth(&state, &headers, query.token.as_deref())?;

    let ok = crate::remote_action::set_clipboard_text(&payload.text);
    if ok {
        Ok((StatusCode::OK, Json(json!({ "success": true, "message": "Workstation clipboard updated" }))))
    } else {
        Ok((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "success": false, "message": "Failed to set workstation clipboard" }))))
    }
}
