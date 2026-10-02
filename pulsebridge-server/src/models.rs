use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum IdeSource {
    Antigravity,
    Cursor,
    VisualStudio,
    VSCode,
    Custom,
}

impl std::fmt::Display for IdeSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            IdeSource::Antigravity => write!(f, "Antigravity"),
            IdeSource::Cursor => write!(f, "Cursor"),
            IdeSource::VisualStudio => write!(f, "Visual Studio"),
            IdeSource::VSCode => write!(f, "VS Code"),
            IdeSource::Custom => write!(f, "Custom IDE"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Idle,
    Thinking,
    RunningTool,
    WaitingInput,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallInfo {
    pub tool_name: String,
    pub action: String,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatStep {
    pub id: String,
    pub step_index: u64,
    pub timestamp: String,
    pub source: String,       // "USER", "MODEL", "SYSTEM"
    pub step_type: String,    // "USER_INPUT", "PLANNER_RESPONSE", "TOOL_EXECUTION", etc.
    pub status: String,       // "DONE", "RUNNING", "ERROR"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCallInfo>>,
    pub ide: IdeSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectChatInfo {
    pub id: String,
    pub project_name: String,
    pub conversation_title: String,
    pub ide: IdeSource,
    pub last_updated: String,
    pub step_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_message_snippet: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskMilestone {
    pub id: String,
    pub title: String,
    pub completed: bool,
    pub in_progress: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskProgress {
    pub task_id: String,
    pub task_title: String,
    pub started_at: String,
    pub elapsed_seconds: u64,
    pub total_steps: usize,
    pub current_step_desc: String,
    pub status: AgentStatus,
    pub percent_complete: u8,
    pub active_ide: IdeSource,
    pub milestones: Vec<TaskMilestone>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemTelemetry {
    pub hostname: String,
    pub os: String,
    pub memory_used_mb: u64,
    pub memory_total_mb: u64,
    pub memory_percent: u8,
    pub battery_percent: Option<u8>,
    pub is_charging: Option<bool>,
    pub lan_ip: String,
    pub server_port: u16,
    pub active_ide_name: String,
    pub uptime_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdeWindowInfo {
    pub hwnd: isize,
    pub title: String,
    pub ide: IdeSource,
    pub width: i32,
    pub height: i32,
    pub is_minimized: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum WsClientMessage {
    #[serde(rename = "auth")]
    Auth { token: String },
    #[serde(rename = "send_prompt")]
    SendPrompt { message: String, target_ide: Option<IdeSource> },
    #[serde(rename = "request_snapshot")]
    RequestSnapshot { window_id: Option<isize>, quality: Option<u8> },
    #[serde(rename = "emergency_stop")]
    EmergencyStop,
    #[serde(rename = "ping")]
    Ping,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum WsServerMessage {
    #[serde(rename = "auth_response")]
    AuthResponse { success: bool, message: String },
    #[serde(rename = "initial_state")]
    InitialState {
        task: TaskProgress,
        recent_steps: Vec<ChatStep>,
        telemetry: SystemTelemetry,
        windows: Vec<IdeWindowInfo>,
        #[serde(default)]
        projects: Vec<ProjectChatInfo>,
    },
    #[serde(rename = "projects_update")]
    ProjectsUpdate(Vec<ProjectChatInfo>),
    #[serde(rename = "step_added")]
    StepAdded(ChatStep),
    #[serde(rename = "progress_update")]
    ProgressUpdate(TaskProgress),
    #[serde(rename = "telemetry_update")]
    TelemetryUpdate(SystemTelemetry),
    #[serde(rename = "screen_frame")]
    ScreenFrame {
        format: String, // "image/jpeg"
        data_base64: String,
        timestamp: String,
        width: u32,
        height: u32,
    },
    #[serde(rename = "alert")]
    Alert {
        id: String,
        level: String, // "info", "success", "warning", "error"
        title: String,
        message: String,
        timestamp: String,
    },
    #[serde(rename = "pong")]
    Pong,
}
