use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use chrono::Local;
use serde::Deserialize;
use serde_json::json;
use tracing::info;
use uuid::Uuid;
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
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct SendPromptPayload {
    pub message: String,
    pub target_ide: Option<String>,
}

pub async fn handle_ingest_event(
    State(state): State<SharedState>,
    Json(payload): Json<IngestEventPayload>,
) -> impl IntoResponse {
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
        return (StatusCode::OK, Json(json!({ "status": "alert_broadcasted" })));
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
    };

    state.add_chat_step(step);
    (StatusCode::OK, Json(json!({ "status": "ingested" })))
}

pub async fn handle_send_prompt(
    State(state): State<SharedState>,
    Json(payload): Json<SendPromptPayload>,
) -> impl IntoResponse {
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
    (StatusCode::OK, Json(result))
}

pub async fn handle_remote_action(
    State(state): State<SharedState>,
    Json(payload): Json<crate::remote_action::RemotePromptCommand>,
) -> impl IntoResponse {
    let result = crate::remote_action::RemoteActionDispatcher::dispatch(payload, &state).await;
    (StatusCode::OK, Json(result))
}

pub async fn handle_mouse_click(
    Json(payload): Json<crate::remote_action::MouseClickCommand>,
) -> impl IntoResponse {
    match crate::remote_action::RemoteActionDispatcher::simulate_click(payload) {
        Ok(_) => (StatusCode::OK, Json(json!({ "success": true }))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "success": false, "error": e }))),
    }
}

pub async fn handle_hotkey(
    Json(payload): Json<crate::remote_action::HotkeyCommand>,
) -> impl IntoResponse {
    match crate::remote_action::RemoteActionDispatcher::simulate_hotkey(&payload.key) {
        Ok(_) => (StatusCode::OK, Json(json!({ "success": true }))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "success": false, "error": e }))),
    }
}


