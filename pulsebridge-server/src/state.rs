use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Instant;
use chrono::Local;
use parking_lot::RwLock;
use tokio::sync::broadcast;
use uuid::Uuid;
use crate::auth::AuthManager;
use crate::models::{
    AgentStatus, ChatStep, IdeSource, ProjectChatInfo, SystemTelemetry, TaskMilestone, TaskProgress,
    WsServerMessage,
};
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
    projects: RwLock<std::collections::HashMap<String, ProjectChatInfo>>,
    task_start_time: Instant,
    broadcast_tx: broadcast::Sender<WsServerMessage>,
    allow_shell_commands: bool,
}

#[allow(dead_code)]
impl SharedState {
    pub fn new(auth: AuthManager, port: u16, allow_shell_commands: bool) -> Self {
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

        let mut initial_projects = std::collections::HashMap::new();
        initial_projects.insert("pulsebridge".to_string(), ProjectChatInfo {
            id: "pulsebridge".to_string(),
            project_name: "PulseBridge".to_string(),
            conversation_title: "Universal AI IDE Companion".to_string(),
            ide: IdeSource::Antigravity,
            last_updated: Local::now().to_rfc3339(),
            step_count: 0,
            latest_message_snippet: Some("Monitoring workstation and IDE stream".to_string()),
            status: "active".to_string(),
            project_path: Some("C:\\PulseBridge".to_string()),
        });

        Self {
            inner: Arc::new(StateInner {
                auth,
                telemetry,
                task_progress: RwLock::new(initial_progress),
                recent_steps: RwLock::new(VecDeque::with_capacity(500)),
                projects: RwLock::new(initial_projects),
                task_start_time: Instant::now(),
                broadcast_tx,
                allow_shell_commands,
            }),
        }
    }

    pub fn is_shell_command_allowed(&self) -> bool {
        self.inner.allow_shell_commands
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
            if steps.len() >= 500 {
                steps.pop_front();
            }
            steps.push_back(step.clone());
        }

        // Dynamically track and update multi-project chat catalogue
        let proj_key = step.conversation_id.clone()
            .or_else(|| step.project_name.clone().map(|p| p.to_lowercase()))
            .unwrap_or_else(|| format!("{:?}", step.ide).to_lowercase());
        let proj_name = step.project_name.clone().unwrap_or_else(|| "Default Project".to_string());
        let conv_title = step.conversation_title.clone().unwrap_or_else(|| "Active Session".to_string());
        let snippet = step.content.as_deref().or(step.thinking.as_deref()).map(|s| {
            let t = s.trim();
            if t.chars().count() > 120 {
                let trunc: String = t.chars().take(117).collect();
                format!("{trunc}...")
            } else {
                t.to_string()
            }
        });

        {
            let mut pmap = self.inner.projects.write();
            let entry = pmap.entry(proj_key).or_insert_with(|| ProjectChatInfo {
                id: step.conversation_id.clone().unwrap_or_else(|| proj_name.to_lowercase()),
                project_name: proj_name.clone(),
                conversation_title: conv_title.clone(),
                ide: step.ide.clone(),
                last_updated: step.timestamp.clone(),
                step_count: 0,
                latest_message_snippet: None,
                status: "active".to_string(),
                project_path: Some(format!("C:\\{}", proj_name)),
            });
            entry.step_count += 1;
            entry.last_updated = step.timestamp.clone();
            if let Some(snip) = snippet {
                entry.latest_message_snippet = Some(snip);
            }
            entry.project_name = proj_name;
            entry.conversation_title = conv_title;
            entry.ide = step.ide.clone();
            entry.status = "active".to_string();
        }

        // Broadcast projects update
        self.broadcast(WsServerMessage::ProjectsUpdate(self.get_project_chats()));

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

        // Broadcast step to all connected clients
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

    pub fn get_recent_steps_filtered(&self, project: Option<&str>, conv_id: Option<&str>) -> Vec<ChatStep> {
        let steps = self.inner.recent_steps.read();
        steps.iter().filter(|s| {
            if let Some(p) = project {
                if let Some(ref sp) = s.project_name {
                    if !sp.eq_ignore_ascii_case(p) {
                        return false;
                    }
                } else {
                    return false;
                }
            }
            if let Some(cid) = conv_id {
                if let Some(ref scid) = s.conversation_id {
                    if scid != cid {
                        return false;
                    }
                } else {
                    return false;
                }
            }
            true
        }).cloned().collect()
    }

    pub fn get_project_chats(&self) -> Vec<ProjectChatInfo> {
        self.get_project_chats_filtered(Some(30))
    }

    pub fn get_project_chats_filtered(&self, max_age_days: Option<u64>) -> Vec<ProjectChatInfo> {
        let days = max_age_days.unwrap_or(30);
        let cutoff_millis = chrono::Utc::now().timestamp_millis() - (days as i64 * 24 * 3600 * 1000);

        let mut list: Vec<ProjectChatInfo> = self.inner.projects.read().values().filter(|p| {
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&p.last_updated) {
                dt.timestamp_millis() >= cutoff_millis
            } else {
                true
            }
        }).cloned().collect();

        list.sort_by(|a, b| b.last_updated.cmp(&a.last_updated));
        list
    }

    pub fn update_project_info(&self, info: ProjectChatInfo) {
        {
            let mut p = self.inner.projects.write();
            p.insert(info.id.clone(), info);
        }
        self.broadcast(WsServerMessage::ProjectsUpdate(self.get_project_chats()));
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
