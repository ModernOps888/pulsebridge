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
    #[serde(default)]
    pub step_type: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    pub content: Option<String>,
    pub thinking: Option<String>,
    pub tool_name: Option<String>,
    pub tool_action: Option<String>,
    #[serde(default)]
    pub tool_calls: Option<Vec<ToolCallInfo>>,
    pub task_title: Option<String>,
    pub percent_complete: Option<u8>,
    pub status: Option<String>,
    pub project_name: Option<String>,
    pub conversation_id: Option<String>,
    pub conversation_title: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SendPromptPayload {
    #[serde(alias = "prompt")]
    pub message: String,
    pub target_ide: Option<String>,
    pub target_project: Option<String>,
    #[serde(default)]
    pub project_name: Option<String>,
    #[serde(default)]
    pub conversation_id: Option<String>,
}

pub async fn handle_ingest_event(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Query(query): Query<AuthHeaderQuery>,
    Json(payload): Json<IngestEventPayload>,
) -> Result<impl IntoResponse, StatusCode> {
    verify_auth(&state, &headers, query.token.as_deref())?;

    let ide_source = match payload.ide.as_deref().unwrap_or("antigravity").to_lowercase().as_str() {
        "cursor" => IdeSource::Cursor,
        "antigravity" => IdeSource::Antigravity,
        "vscode" => IdeSource::VSCode,
        "visualstudio" | "visual studio" => IdeSource::VisualStudio,
        _ => IdeSource::Custom,
    };

    if payload.event_type == "alert" {
        let default_title = format!("Alert from {}", ide_source);
        let alert_title = payload.task_title.as_deref().unwrap_or(&default_title);
        state.send_alert(
            payload.status.as_deref().unwrap_or("info"),
            alert_title,
            payload.content.as_deref().unwrap_or(""),
        );
        return Ok((StatusCode::OK, Json(json!({ "status": "alert_broadcasted" }))));
    }

    if payload.event_type == "status" {
        let mapped_status = payload.status.as_deref().map(|s| match s.to_lowercase().as_str() {
            "thinking" => crate::models::AgentStatus::Thinking,
            "runningtool" | "running_tool" | "running" => crate::models::AgentStatus::RunningTool,
            "waitinginput" | "waiting_input" | "waiting" => crate::models::AgentStatus::WaitingInput,
            "completed" | "done" => crate::models::AgentStatus::Completed,
            "failed" | "error" => crate::models::AgentStatus::Failed,
            _ => crate::models::AgentStatus::Idle,
        });

        state.update_task_progress(|p| {
            if let Some(ref title) = payload.task_title {
                p.task_title = title.clone();
            }
            if let Some(ref step_desc) = payload.content {
                p.current_step_desc = step_desc.clone();
            }
            if let Some(percent) = payload.percent_complete {
                p.percent_complete = percent;
            }
            if let Some(st) = mapped_status {
                p.status = st;
            }
            p.active_ide = ide_source.clone();
        });
        return Ok((StatusCode::OK, Json(json!({ "status": "status_updated" }))));
    }

    if let Some(ref title) = payload.task_title {
        let t = title.clone();
        let ide_c = ide_source.clone();
        let pct = payload.percent_complete;
        state.update_task_progress(|p| {
            p.task_title = t;
            p.active_ide = ide_c;
            if let Some(percent) = pct {
                p.percent_complete = percent;
            }
        });
    }

    let tool_calls = if payload.tool_calls.is_some() {
        payload.tool_calls
    } else if let Some(tname) = payload.tool_name {
        Some(vec![ToolCallInfo {
            tool_name: tname,
            action: payload.tool_action.unwrap_or_else(|| "Running".to_string()),
            summary: payload.content.clone().unwrap_or_default(),
            arguments: None,
            output: None,
            target_file: None,
            status: Some("DONE".to_string()),
        }])
    } else {
        None
    };

    let resolved_step_type = payload.step_type.unwrap_or_else(|| {
        if tool_calls.is_some() {
            "PLANNER_RESPONSE".to_string()
        } else {
            "EVENT".to_string()
        }
    });

    let step = ChatStep {
        id: Uuid::new_v4().to_string(),
        step_index: state.get_recent_steps().len() as u64 + 1,
        timestamp: Local::now().to_rfc3339(),
        source: payload.source.unwrap_or_else(|| "MODEL".to_string()),
        step_type: resolved_step_type,
        status: payload.status.unwrap_or_else(|| "DONE".to_string()),
        content: payload.content,
        thinking: payload.thinking,
        tool_calls,
        ide: ide_source,
        project_name: payload.project_name,
        conversation_id: payload.conversation_id,
        conversation_title: payload.conversation_title,
        input_tokens: None,
        output_tokens: None,
        cache_read_tokens: None,
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
        project_path: payload.target_project,
        command: None,
        project_name: payload.project_name,
        conversation_id: payload.conversation_id,
    };

    let result = crate::remote_action::RemoteActionDispatcher::dispatch(cmd, &state).await;
    Ok((StatusCode::OK, Json(result)))
}

#[derive(Debug, Deserialize)]
pub struct InboxQuery {
    pub token: Option<String>,
    pub unread_only: Option<bool>,
    pub ack: Option<bool>,
}

pub async fn handle_get_inbox(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Query(query): Query<InboxQuery>,
) -> Result<impl IntoResponse, StatusCode> {
    verify_auth(&state, &headers, query.token.as_deref())?;
    let unread_only = query.unread_only.unwrap_or(true);
    let mark_read = query.ack.unwrap_or(false);
    let items = state.get_inbox_messages(unread_only, mark_read);
    Ok((StatusCode::OK, Json(json!({ "success": true, "messages": items }))))
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

    match crate::remote_action::RemoteActionDispatcher::simulate_hotkey(&payload.key, payload.window_id) {
        Ok(_) => Ok((StatusCode::OK, Json(json!({ "success": true })))),
        Err(e) => Ok((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "success": false, "error": e })))),
    }
}

pub async fn handle_type_text(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Query(query): Query<AuthHeaderQuery>,
    Json(payload): Json<crate::remote_action::TypeTextCommand>,
) -> Result<impl IntoResponse, StatusCode> {
    verify_auth(&state, &headers, query.token.as_deref())?;

    match crate::remote_action::RemoteActionDispatcher::simulate_type_text(payload) {
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
