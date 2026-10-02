use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Instant;
use chrono::Local;
use parking_lot::RwLock;
use tokio::sync::broadcast;
use uuid::Uuid;
use crate::auth::AuthManager;
use crate::models::{AgentStatus, ChatStep, IdeSource, SystemTelemetry, TaskMilestone, TaskProgress, WsServerMessage};
use crate::system_telemetry::TelemetryCollector;

#[derive(Clone)]
pub struct SharedState {
    inner: Arc<StateInner>,
}

struct StateInner {
    auth: AuthManager,
    telemetry: TelemetryCollector,
    task_progress: RwLock<TaskProgress>,
    recent_steps: RwLock<VecDeque<ChatStep>>,
    task_start_time: Instant,
    broadcast_tx: broadcast::Sender<WsServerMessage>,
}

#[allow(dead_code)]
impl SharedState {
    pub fn new(auth: AuthManager, port: u16) -> Self {
        let (broadcast_tx, _) = broadcast::channel(100);
        let lan_ip = auth.get_lan_ip().to_string();
        let telemetry = TelemetryCollector::new(lan_ip, port);

        let initial_progress = TaskProgress {
            task_id: "init".to_string(),
            task_title: "Monitoring Active IDE...".to_string(),
            started_at: Local::now().to_rfc3339(),
            elapsed_seconds: 0,
            total_steps: 0,
            current_step_desc: "Ready for task delegation".to_string(),
            status: AgentStatus::Idle,
            percent_complete: 0,
            active_ide: IdeSource::Antigravity,
            milestones: vec![
                TaskMilestone {
                    id: "m-1".to_string(),
                    title: "Bridge Server Connection Established".to_string(),
                    completed: true,
                    in_progress: false,
                },
                TaskMilestone {
                    id: "m-2".to_string(),
                    title: "Awaiting IDE Activity or Goal".to_string(),
                    completed: false,
                    in_progress: true,
                },
            ],
        };

        Self {
            inner: Arc::new(StateInner {
                auth,
                telemetry,
                task_progress: RwLock::new(initial_progress),
                recent_steps: RwLock::new(VecDeque::with_capacity(250)),
                task_start_time: Instant::now(),
                broadcast_tx,
            }),
        }
    }

    pub fn auth(&self) -> &AuthManager {
        &self.inner.auth
    }

    pub fn telemetry(&self) -> &TelemetryCollector {
        &self.inner.telemetry
    }

    pub fn subscribe(&self) -> broadcast::Receiver<WsServerMessage> {
        self.inner.broadcast_tx.subscribe()
    }

    pub fn broadcast(&self, msg: WsServerMessage) {
        let _ = self.inner.broadcast_tx.send(msg);
    }

    pub fn add_chat_step(&self, step: ChatStep) {
        {
            let mut steps = self.inner.recent_steps.write();
            // Check if step already exists (avoid duplicate on re-read)
            if steps.iter().any(|s| s.id == step.id) {
                return;
            }
            if steps.len() >= 250 {
                steps.pop_front();
            }
            steps.push_back(step.clone());
        }

        // Dynamically adjust task status & telemetry based on step
        let step_desc = if let Some(ref calls) = step.tool_calls {
            if let Some(first) = calls.first() {
                format!("{}: {}", first.tool_name, first.action)
            } else {
                "Executing action".to_string()
            }
        } else if step.source == "USER" {
            "Analyzing new user prompt".to_string()
        } else if step.thinking.is_some() {
            "Reasoning & planning next steps".to_string()
        } else {
            step.status.clone()
        };

        let new_status = if step.source == "USER" {
            AgentStatus::Thinking
        } else if step.tool_calls.is_some() {
            AgentStatus::RunningTool
        } else if step.status == "RUNNING" {
            AgentStatus::RunningTool
        } else if step.status == "ERROR" {
            AgentStatus::Failed
        } else {
            AgentStatus::WaitingInput
        };

        self.update_task_progress(|p| {
            p.total_steps += 1;
            p.current_step_desc = step_desc;
            p.status = new_status;
            p.active_ide = step.ide.clone();
        });

        // Broadcast to all phone clients
        self.broadcast(WsServerMessage::StepAdded(step));
    }

    pub fn update_task_progress<F>(&self, f: F)
    where
        F: FnOnce(&mut TaskProgress),
    {
        let updated = {
            let mut p = self.inner.task_progress.write();
            p.elapsed_seconds = self.inner.task_start_time.elapsed().as_secs();
            f(&mut p);
            p.clone()
        };

        self.broadcast(WsServerMessage::ProgressUpdate(updated));
    }

    pub fn get_task_progress(&self) -> TaskProgress {
        let mut p = self.inner.task_progress.read().clone();
        p.elapsed_seconds = self.inner.task_start_time.elapsed().as_secs();
        p
    }

    pub fn get_recent_steps(&self) -> Vec<ChatStep> {
        self.inner.recent_steps.read().iter().cloned().collect()
    }

    pub fn get_telemetry(&self) -> SystemTelemetry {
        self.inner.telemetry.collect()
    }

    pub fn send_alert(&self, level: &str, title: &str, message: &str) {
        let alert = WsServerMessage::Alert {
            id: Uuid::new_v4().to_string(),
            level: level.to_string(),
            title: title.to_string(),
            message: message.to_string(),
            timestamp: Local::now().to_rfc3339(),
        };
        self.broadcast(alert);
    }
}
