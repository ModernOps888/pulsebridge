use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::IntoResponse,
};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use chrono::Local;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::time::interval;

use crate::capture::ScreenCapturer;
use crate::models::{IdeSource, WsClientMessage, WsServerMessage};
use crate::state::SharedState;

#[derive(Debug, Deserialize)]
pub struct WsQuery {
    pub token: Option<String>,
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<SharedState>,
    Query(query): Query<WsQuery>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state, query.token))
}

async fn handle_socket(socket: WebSocket, state: SharedState, initial_token: Option<String>) {
    let (mut sender, mut receiver) = socket.split();

    // Check if initial token was provided in query param
    let mut is_authenticated = false;
    if let Some(ref tok) = initial_token {
        if state.auth().is_token_valid(tok) {
            is_authenticated = true;
        }
    }

    let auth_flag = Arc::new(AtomicBool::new(is_authenticated));

    // If pre-authenticated via query token, send initial state immediately
    if is_authenticated {
        let init_msg = WsServerMessage::InitialState {
            task: state.get_task_progress(),
            recent_steps: state.get_recent_steps(),
            telemetry: state.get_telemetry(),
            windows: ScreenCapturer::list_ide_windows(),
            projects: state.get_project_chats(),
        };

        if let Ok(json_str) = serde_json::to_string(&init_msg) {
            let _ = sender.send(Message::Text(json_str)).await;
        }
    }

    let mut broadcast_rx = state.subscribe();
    let state_for_reader = state.clone();

    // Channel for forwarding messages to WebSocket writer
    let (ws_out_tx, mut ws_out_rx) = tokio::sync::mpsc::unbounded_channel::<Message>();

    // Task 1: Forward from internal channel to WebSocket sender
    let writer_task = tokio::spawn(async move {
        while let Some(msg) = ws_out_rx.recv().await {
            if sender.send(msg).await.is_err() {
                break;
            }
        }
    });

    // Task 2: Broadcast listener forwarding to ws_out_tx (GATED strictly by authentication)
    let ws_out_tx_broadcast = ws_out_tx.clone();
    let auth_flag_broadcast = auth_flag.clone();
    let broadcast_task = tokio::spawn(async move {
        while let Ok(server_msg) = broadcast_rx.recv().await {
            if !auth_flag_broadcast.load(Ordering::Relaxed) {
                continue;
            }
            if let Ok(json) = serde_json::to_string(&server_msg) {
                if ws_out_tx_broadcast.send(Message::Text(json)).is_err() {
                    break;
                }
            }
        }
    });

    // Task 3: Telemetry heartbeat (every 3s, GATED strictly by authentication)
    let ws_out_tx_heartbeat = ws_out_tx.clone();
    let state_telemetry = state.clone();
    let auth_flag_telem = auth_flag.clone();
    let telemetry_task = tokio::spawn(async move {
        let mut tick = interval(Duration::from_secs(3));
        loop {
            tick.tick().await;
            if !auth_flag_telem.load(Ordering::Relaxed) {
                continue;
            }
            let telem = state_telemetry.get_telemetry();
            let msg = WsServerMessage::TelemetryUpdate(telem);
            if let Ok(json) = serde_json::to_string(&msg) {
                if ws_out_tx_heartbeat.send(Message::Text(json)).is_err() {
                    break;
                }
            }
        }
    });

    // Task 4: Unauthenticated connection timeout (15s disconnect)
    let auth_flag_timeout = auth_flag.clone();
    let ws_out_tx_timeout = ws_out_tx.clone();
    let timeout_task = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(15)).await;
        if !auth_flag_timeout.load(Ordering::Relaxed) {
            let _ = ws_out_tx_timeout.send(Message::Close(None));
        }
    });

    // Reader loop: handle incoming messages from mobile client
    while let Some(Ok(msg)) = receiver.next().await {
        match msg {
            Message::Text(text) => {
                if let Ok(client_msg) = serde_json::from_str::<WsClientMessage>(&text) {
                    match client_msg {
                        WsClientMessage::Auth { token } => {
                            if state_for_reader.auth().is_token_valid(&token) {
                                is_authenticated = true;
                                auth_flag.store(true, Ordering::Relaxed);
                                let resp = WsServerMessage::AuthResponse {
                                    success: true,
                                    message: "Access granted".to_string(),
                                };
                                let init = WsServerMessage::InitialState {
                                    task: state_for_reader.get_task_progress(),
                                    recent_steps: state_for_reader.get_recent_steps(),
                                    telemetry: state_for_reader.get_telemetry(),
                                    windows: ScreenCapturer::list_ide_windows(),
                                    projects: state_for_reader.get_project_chats(),
                                };
                                let _ = ws_out_tx.send(Message::Text(serde_json::to_string(&resp).unwrap()));
                                let _ = ws_out_tx.send(Message::Text(serde_json::to_string(&init).unwrap()));
                            } else {
                                let resp = WsServerMessage::AuthResponse {
                                    success: false,
                                    message: "Invalid authentication token".to_string(),
                                };
                                let _ = ws_out_tx.send(Message::Text(serde_json::to_string(&resp).unwrap()));
                            }
                        }
                        WsClientMessage::Ping => {
                            let resp = WsServerMessage::Pong;
                            let _ = ws_out_tx.send(Message::Text(serde_json::to_string(&resp).unwrap()));
                        }
                        _ if !is_authenticated => {
                            let resp = WsServerMessage::AuthResponse {
                                success: false,
                                message: "Authentication required".to_string(),
                            };
                            let _ = ws_out_tx.send(Message::Text(serde_json::to_string(&resp).unwrap()));
                        }
                        WsClientMessage::SendPrompt { message, target_ide } => {
                            let ide = target_ide.unwrap_or(IdeSource::Antigravity);
                            let cmd = crate::remote_action::RemotePromptCommand {
                                message,
                                target_ide: Some(ide),
                                action_mode: Some(crate::remote_action::RemoteActionMode::InjectWindow),
                                project_path: None,
                                command: None,
                            };
                            crate::remote_action::RemoteActionDispatcher::dispatch(cmd, &state_for_reader).await;
                        }
                        WsClientMessage::RequestSnapshot { window_id, quality } => {
                            let q = quality.unwrap_or(65);
                            let capture_res = match window_id {
                                Some(hwnd) if hwnd > 0 => ScreenCapturer::capture_window(hwnd, q),
                                _ => ScreenCapturer::capture_desktop(q),
                            };

                            if let Ok(jpeg) = capture_res {
                                let b64 = BASE64.encode(jpeg);
                                let frame_msg = WsServerMessage::ScreenFrame {
                                    format: "image/jpeg".to_string(),
                                    data_base64: b64,
                                    timestamp: Local::now().to_rfc3339(),
                                    width: 1280,
                                    height: 720,
                                };
                                let _ = ws_out_tx.send(Message::Text(serde_json::to_string(&frame_msg).unwrap()));
                            }
                        }
                        WsClientMessage::EmergencyStop => {
                            state_for_reader.send_alert("warning", "Emergency Stop Triggered", "User pressed Stop from phone");
                        }
                    }
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    writer_task.abort();
    broadcast_task.abort();
    telemetry_task.abort();
    timeout_task.abort();
}
